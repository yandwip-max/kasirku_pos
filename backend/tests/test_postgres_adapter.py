import json
from datetime import datetime, timezone

from lib.postgres import _Sql, _apply_update, _document


def test_filter_compiles_ranges_or_and_nested_array_match():
    builder = _Sql()
    sql = builder.condition(
        {
            "store_id": "store-1",
            "created_at": {"$gte": datetime(2026, 9, 1, tzinfo=timezone.utc)},
            "$or": [
                {"status": {"$ne": "void"}},
                {"items.imei": {"$regex": "123", "$options": "i"}},
            ],
        }
    )

    assert "document #> '{store_id}'" in sql
    assert "document #> '{created_at}' >= " in sql
    assert " OR " in sql
    assert "jsonb_array_elements" in sql
    assert "~*" in sql
    assert "COALESCE((item #> '{imei}')::text, '')" in sql
    assert len(builder.args) == 4


def test_update_operators_preserve_document_fields():
    updated = _apply_update(
        {"id": "p-1", "stock_qty": 8, "nested": {"keep": True}},
        {"$set": {"nested.name": "case"}, "$inc": {"stock_qty": -3}},
    )

    assert updated == {"id": "p-1", "stock_qty": 5, "nested": {"keep": True, "name": "case"}}


def test_document_decodes_jsonb_and_restores_datetime():
    doc = _document({"document": json.dumps({"created_at": "2026-09-30T12:00:00+00:00", "items": []})})

    assert doc["created_at"] == datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
    assert doc["items"] == []
