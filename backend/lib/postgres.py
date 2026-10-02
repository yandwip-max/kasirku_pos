"""PostgreSQL-backed compatibility layer for the existing document CRUD surface."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from contextvars import ContextVar
from datetime import datetime
from functools import wraps
from pathlib import Path
from typing import Any, Mapping, Optional, Sequence
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import asyncpg
from pymongo.errors import DuplicateKeyError

logger = logging.getLogger(__name__)

COLLECTIONS = {
    "status_checks", "stores", "users", "attendance", "daily_report_runs",
    "products", "product_units", "transactions", "transaction_items",
    "activity_logs", "categories", "email_tests", "cron_runs", "backups",
}

_connection: ContextVar[Optional[asyncpg.Connection]] = ContextVar("postgres_connection", default=None)


def _json(value: Any) -> str:
    return json.dumps(value, default=lambda item: item.isoformat() if hasattr(item, "isoformat") else str(item))


def _path_parts(path: str) -> list[str]:
    return path.split(".")


def _json_path(path: str) -> str:
    return "{" + ",".join(part.replace("\"", "") for part in _path_parts(path)) + "}"


class _Sql:
    def __init__(self) -> None:
        self.args: list[Any] = []

    def bind(self, value: Any, cast: str = "jsonb") -> str:
        self.args.append(_json(value) if cast == "jsonb" else value)
        return f"${len(self.args)}::{cast}"

    def field(self, path: str, alias: str = "document") -> str:
        return f"{alias} #> '{_json_path(path)}'"

    def scalar(self, path: str, alias: str = "document") -> str:
        return f"{alias} #>> '{_json_path(path)}'"

    def condition(self, query: Mapping[str, Any], alias: str = "document") -> str:
        terms: list[str] = []
        for key, value in query.items():
            if key == "$or":
                terms.append("(" + " OR ".join(self.condition(item, alias) for item in value) + ")")
            elif key == "$and":
                terms.append("(" + " AND ".join(self.condition(item, alias) for item in value) + ")")
            elif key == "$expr":
                left, right = value["$lte"]
                terms.append(f"({self.scalar(left[1:])})::numeric <= ({self.scalar(right[1:])})::numeric")
            elif "." in key and key.split(".", 1)[0] == "items":
                subpath = _json_path(".".join(key.split(".")[1:]))
                test = self._value_test(f"item #> '{subpath}'", value)
                terms.append(f"EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(document->'items','[]'::jsonb)) item WHERE {test})")
            else:
                terms.append(self._value_test(self.field(key, alias), value, self.scalar(key, alias)))
        return " AND ".join(terms) if terms else "TRUE"

    def _value_test(self, field: str, value: Any, scalar: Optional[str] = None) -> str:
        if isinstance(value, Mapping) and any(str(key).startswith("$") for key in value):
            clauses = []
            for op, operand in value.items():
                if op == "$regex":
                    flags = "~*" if value.get("$options") == "i" else "~"
                    regex_field = scalar if scalar is not None else f"({field})::text"
                    clauses.append(f"COALESCE({regex_field}, '') {flags} {self.bind(operand, 'text')}")
                elif op == "$options":
                    continue
                elif op == "$in":
                    clauses.append(f"{field} = ANY(SELECT jsonb_array_elements({self.bind(operand)}))")
                elif op == "$ne":
                    clauses.append(f"COALESCE({field}, 'null'::jsonb) <> {self.bind(operand)}")
                elif op in {"$gte", "$gt", "$lte", "$lt"}:
                    operator = {"$gte": ">=", "$gt": ">", "$lte": "<=", "$lt": "<"}[op]
                    clauses.append(f"{field} {operator} {self.bind(operand)}")
                elif op == "$exists":
                    clauses.append(f"({field} IS NOT NULL) = {self.bind(bool(operand), 'boolean')}")
                elif op == "$type":
                    clauses.append(f"jsonb_typeof({field}) = {self.bind(operand, 'text')}")
                else:
                    raise ValueError(f"Unsupported Mongo operator: {op}")
            return " AND ".join(clauses) if clauses else "TRUE"
        if value is None:
            return f"({field} IS NULL OR {field} = 'null'::jsonb)"
        return f"{field} = {self.bind(value)}"


def _document(row: asyncpg.Record | None) -> Optional[dict]:
    if row is None:
        return None
    result = row["document"]
    value = json.loads(result) if isinstance(result, str) else dict(result)
    datetime_fields = {
        "timestamp", "created_at", "due_date", "piutang_paid_at", "sold_at", "voided_at", "check_in_at",
        "check_out_at", "started_at", "finished_at", "sent_at", "at",
    }

    def restore_dates(item: Any) -> Any:
        if isinstance(item, list):
            return [restore_dates(entry) for entry in item]
        if isinstance(item, dict):
            return {
                key: datetime.fromisoformat(val.replace("Z", "+00:00"))
                if key in datetime_fields and isinstance(val, str) and "T" in val
                else restore_dates(val)
                for key, val in item.items()
            }
        return item

    return restore_dates(value)


class Cursor:
    def __init__(self, collection: "Collection", query: Optional[Mapping[str, Any]] = None) -> None:
        self.collection = collection
        self.query = dict(query or {})
        self.order: list[tuple[str, int]] = []
        self.offset = 0
        self.limit_value: Optional[int] = None
        self._rows: Optional[list[dict]] = None
        self._position = 0

    def sort(self, key: Any, direction: Optional[int] = None) -> "Cursor":
        self.order = [(key, direction or 1)] if isinstance(key, str) else list(key)
        return self

    def skip(self, amount: int) -> "Cursor":
        self.offset = amount
        return self

    def limit(self, amount: int) -> "Cursor":
        self.limit_value = amount
        return self

    async def to_list(self, length: Optional[int] = None) -> list[dict]:
        max_rows = self.limit_value
        if length is not None:
            max_rows = length if max_rows is None else min(max_rows, length)
        return await self.collection._select(self.query, self.order, self.offset, max_rows)

    async def _load(self) -> None:
        if self._rows is None:
            self._rows = await self.to_list()

    def __aiter__(self) -> "Cursor":
        return self

    async def __anext__(self) -> dict:
        await self._load()
        assert self._rows is not None
        if self._position >= len(self._rows):
            raise StopAsyncIteration
        row = self._rows[self._position]
        self._position += 1
        return row


class AggregateCursor(Cursor):
    def __init__(self, collection: "Collection", pipeline: Sequence[Mapping[str, Any]]) -> None:
        super().__init__(collection)
        self.pipeline = list(pipeline)

    async def to_list(self, length: Optional[int] = None) -> list[dict]:
        matches: list[Mapping[str, Any]] = []
        group: Optional[Mapping[str, Any]] = None
        for stage in self.pipeline:
            if "$match" in stage:
                matches.append(stage["$match"])
            elif "$group" in stage:
                group = stage["$group"]
            else:
                raise ValueError(f"Unsupported aggregate stage: {next(iter(stage))}")
        if not group:
            return await self.collection._select({"$and": matches}, [], 0, length)
        group_path = str(group["_id"]).removeprefix("$")
        sum_expression = group.get("count", {}).get("$sum", 1)
        query = _Sql()
        where = query.condition({"$and": matches})
        value = "1" if sum_expression == 1 else "(document #>> '{" + str(sum_expression).removeprefix("$") + "}')::numeric"
        sql = f"SELECT document #> '{_json_path(group_path)}' AS group_id, SUM({value}) AS group_count FROM {self.collection.name} WHERE {where} GROUP BY 1"
        rows = await self.collection.database._fetch(sql, query.args)
        return [
            {
                "_id": json.loads(row["group_id"]) if isinstance(row["group_id"], str) else row["group_id"],
                "count": int(row["group_count"]),
            }
            for row in rows
        ]


class Collection:
    def __init__(self, database: "Database", name: str) -> None:
        if name not in COLLECTIONS:
            raise ValueError(f"Unknown collection: {name}")
        self.database = database
        self.name = name

    def find(self, query: Optional[Mapping[str, Any]] = None) -> Cursor:
        return Cursor(self, query)

    async def find_one(self, query: Optional[Mapping[str, Any]] = None) -> Optional[dict]:
        rows = await self._select(query or {}, [], 0, 1)
        return rows[0] if rows else None

    async def lock_one(self, query: Mapping[str, Any]) -> bool:
        builder = _Sql()
        where = builder.condition(query)
        row = await self.database._fetchrow(
            f"SELECT id FROM {self.name} WHERE {where} LIMIT 1 FOR UPDATE", builder.args
        )
        return row is not None

    async def insert_one(self, doc: Mapping[str, Any]):
        if _connection.get() is None:
            pool = await self.database._ensure_pool()
            async with pool.acquire() as connection:
                async with connection.transaction():
                    token = _connection.set(connection)
                    try:
                        return await self.insert_one(doc)
                    finally:
                        _connection.reset(token)
        document = dict(doc)
        row_id = str(document.get("id") or document.get("run_id") or uuid.uuid4())
        document.setdefault("id", row_id)
        columns, values = self._columns(document, row_id)
        json_columns = {"document"}
        placeholders = ", ".join(
            f"${index}::{('jsonb' if column in json_columns else 'text')}"
            for index, column in enumerate(columns, 1)
        )
        sql = f"INSERT INTO {self.name} ({', '.join(columns)}) VALUES ({placeholders})"
        try:
            await self.database._execute(sql, values)
        except asyncpg.UniqueViolationError as exc:
            raise DuplicateKeyError(str(exc)) from exc
        if self.name == "transactions":
            await self._insert_items(document)
        return type("InsertOneResult", (), {"inserted_id": row_id})()

    async def insert_many(self, docs: Sequence[Mapping[str, Any]]):
        active = _connection.get()
        if active is not None:
            results = [await self.insert_one(doc) for doc in docs]
            return type("InsertManyResult", (), {"inserted_ids": [r.inserted_id for r in results]})()
        pool = await self.database._ensure_pool()
        async with pool.acquire() as connection:
            async with connection.transaction():
                token = _connection.set(connection)
                try:
                    results = [await self.insert_one(doc) for doc in docs]
                    return type("InsertManyResult", (), {"inserted_ids": [r.inserted_id for r in results]})()
                finally:
                    _connection.reset(token)

    async def _insert_items(self, doc: Mapping[str, Any]) -> None:
        for index, item in enumerate(doc.get("items", [])):
            await self.database._execute(
                "INSERT INTO transaction_items (id, transaction_id, store_id, product_id, unit_id, position, document) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)",
                [str(uuid.uuid4()), doc["id"], doc.get("store_id"), item["product_id"], item.get("unit_id"), index, _json(item)],
            )

    def _columns(self, document: dict, row_id: str) -> tuple[list[str], list[Any]]:
        columns = ["id", "store_id", "document"]
        values: list[Any] = [row_id, document.get("store_id"), _json(document)]
        if self.name == "users":
            columns.append("email"); values.append(document.get("email"))
        elif self.name == "product_units":
            columns.append("product_id"); values.append(document.get("product_id"))
        elif self.name == "attendance":
            columns.extend(["user_id", "work_date"]); values.extend([document.get("user_id"), document.get("work_date")])
        elif self.name in {"daily_report_runs", "email_tests"}:
            columns.append("user_id"); values.append(document.get("user_id"))
        casts = ["text", "text", "jsonb"] + ["text"] * (len(columns) - 3)
        if self.name == "attendance":
            casts[-1] = "text"
        return columns, values

    async def _select(self, query: Mapping[str, Any], order: Sequence[tuple[str, int]], offset: int, limit: Optional[int]) -> list[dict]:
        builder = _Sql()
        where = builder.condition(query)
        order_sql = ", ".join(f"document #>> '{_json_path(key)}' {'DESC' if direction < 0 else 'ASC'}" for key, direction in order)
        sql = f"SELECT document FROM {self.name} WHERE {where}"
        if order_sql:
            sql += f" ORDER BY {order_sql}"
        if limit is not None:
            builder.args.append(limit); sql += f" LIMIT ${len(builder.args)}"
        if offset:
            builder.args.append(offset); sql += f" OFFSET ${len(builder.args)}"
        rows = await self.database._fetch(sql, builder.args)
        return [value for row in rows if (value := _document(row)) is not None]

    async def count_documents(self, query: Optional[Mapping[str, Any]] = None) -> int:
        builder = _Sql(); where = builder.condition(query or {})
        row = await self.database._fetchrow(f"SELECT COUNT(*) AS count FROM {self.name} WHERE {where}", builder.args)
        return row["count"]

    async def update_one(self, query: Mapping[str, Any], update: Mapping[str, Any], upsert: bool = False):
        before = await self.find_one(query)
        if before is None:
            if not upsert:
                return type("UpdateResult", (), {"matched_count": 0, "modified_count": 0, "upserted_id": None})()
            before = {key: value for key, value in query.items() if not key.startswith("$") and not isinstance(value, Mapping)}
            after = _apply_update(before, update)
            await self.insert_one(after)
            return type("UpdateResult", (), {"matched_count": 0, "modified_count": 0, "upserted_id": after.get("id")})()
        updated = await self.find_one_and_update(query, update, return_document=1)
        matched = int(updated is not None)
        return type("UpdateResult", (), {"matched_count": matched, "modified_count": matched, "upserted_id": None})()

    async def update_many(self, query: Mapping[str, Any], update: Mapping[str, Any]):
        docs = await self._select(query, [], 0, None)
        for doc in docs:
            await self.find_one_and_update({"id": doc.get("id") or doc.get("run_id")}, update)
        return type("UpdateResult", (), {"matched_count": len(docs), "modified_count": len(docs)})()

    async def find_one_and_update(self, query: Mapping[str, Any], update: Mapping[str, Any], **kwargs):
        doc = await self.find_one(query)
        if doc is None:
            return None
        updated = _apply_update(doc, update)
        builder = _Sql(); where = builder.condition(query)
        builder.args.append(_json(updated)); document_arg = f"${len(builder.args)}::jsonb"
        sql = f"UPDATE {self.name} SET document = {document_arg}"
        if self.name == "users":
            builder.args.append(updated.get("email")); sql += f", email = ${len(builder.args)}"
        if self.name == "product_units":
            builder.args.append(updated.get("product_id")); sql += f", product_id = ${len(builder.args)}"
        if self.name in {"users", "attendance", "daily_report_runs", "email_tests"}:
            builder.args.append(updated.get("user_id")); sql += f", user_id = ${len(builder.args)}"
        sql += f" WHERE {where} RETURNING document"
        row = await self.database._fetchrow(sql, builder.args)
        result = _document(row)
        return result if kwargs.get("return_document") == 1 else doc if result else None

    async def delete_one(self, query: Mapping[str, Any]):
        builder = _Sql(); where = builder.condition(query)
        row = await self.database._fetchrow(f"DELETE FROM {self.name} WHERE id = (SELECT id FROM {self.name} WHERE {where} LIMIT 1) RETURNING id", builder.args)
        return type("DeleteResult", (), {"deleted_count": int(row is not None)})()

    async def delete_many(self, query: Optional[Mapping[str, Any]] = None):
        builder = _Sql(); where = builder.condition(query or {})
        rows = await self.database._fetch(f"DELETE FROM {self.name} WHERE {where} RETURNING id", builder.args)
        return type("DeleteResult", (), {"deleted_count": len(rows)})()

    def aggregate(self, pipeline: Sequence[Mapping[str, Any]]) -> AggregateCursor:
        return AggregateCursor(self, pipeline)


class _null_async_context:
    async def __aenter__(self): return None
    async def __aexit__(self, *_args): return False


def _set_path(document: dict, path: str, value: Any) -> None:
    parts = _path_parts(path); target = document
    for part in parts[:-1]:
        target = target.setdefault(part, {})
    target[parts[-1]] = value


def _apply_update(document: dict, update: Mapping[str, Any]) -> dict:
    result = dict(document)
    if not any(key.startswith("$") for key in update):
        return dict(update)
    for path, value in update.get("$set", {}).items(): _set_path(result, path, value)
    for path, value in update.get("$inc", {}).items():
        parts = _path_parts(path); current = result
        for part in parts[:-1]: current = current.setdefault(part, {})
        current[parts[-1]] = current.get(parts[-1], 0) + value
    for path in update.get("$unset", {}):
        parts = _path_parts(path); current = result
        for part in parts[:-1]: current = current.get(part, {})
        current.pop(parts[-1], None)
    return result


class Database:
    def __init__(self, dsn: str) -> None:
        parts = urlsplit(dsn)
        query = parse_qs(parts.query)
        sslmode = query.pop("sslmode", [None])[0]
        self.dsn = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query, doseq=True), parts.fragment))
        self.ssl = sslmode
        self.pool: Optional[asyncpg.Pool] = None
        self._pool_lock = asyncio.Lock()

    def __getattr__(self, name: str) -> Collection:
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]

    def __getitem__(self, name: str) -> Collection:
        return Collection(self, name)

    async def _ensure_pool(self) -> asyncpg.Pool:
        if self.pool is None:
            async with self._pool_lock:
                if self.pool is None:
                    self.pool = await asyncpg.create_pool(
                        self.dsn, min_size=1, max_size=10, command_timeout=30, ssl=self.ssl
                    )
        return self.pool

    async def _connection(self) -> tuple[asyncpg.Connection, bool]:
        active = _connection.get()
        if active is not None:
            return active, False
        return await (await self._ensure_pool()).acquire(), True

    async def _release(self, connection: asyncpg.Connection) -> None:
        if self.pool is not None:
            await self.pool.release(connection)

    async def _fetch(self, sql: str, args: Sequence[Any]):
        connection, owns = await self._connection()
        try: return await connection.fetch(sql, *args)
        finally:
            if owns: await self._release(connection)

    async def _fetchrow(self, sql: str, args: Sequence[Any]):
        connection, owns = await self._connection()
        try: return await connection.fetchrow(sql, *args)
        finally:
            if owns: await self._release(connection)

    async def _execute(self, sql: str, args: Sequence[Any]):
        connection, owns = await self._connection()
        try: return await connection.execute(sql, *args)
        finally:
            if owns: await self._release(connection)

    def transactional(self, function):
        @wraps(function)
        async def wrapped(*args, **kwargs):
            active = _connection.get()
            if active is not None:
                return await function(*args, **kwargs)
            pool = await self._ensure_pool()
            async with pool.acquire() as connection:
                async with connection.transaction():
                    token = _connection.set(connection)
                    try:
                        return await function(*args, **kwargs)
                    finally:
                        _connection.reset(token)
        return wrapped

    async def close(self) -> None:
        if self.pool is not None:
            await self.pool.close()
            self.pool = None

    async def ensure_schema(self) -> None:
        pool = await self._ensure_pool()
        schema = Path(__file__).resolve().parent.parent / "schema.sql"
        async with pool.acquire() as connection:
            await connection.execute(schema.read_text(encoding="utf-8"))


class Client:
    def __init__(self, database: Database) -> None:
        self.database = database

    async def close(self) -> None:
        await self.database.close()
