import base64
import os

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from lib.auth import Principal, get_principal

router = APIRouter(prefix="/ai")
MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


@router.post("/vision/analyze")
async def analyze_image(
    image: UploadFile = File(...),
    question: str = Form(default="Identifikasi produk yang terlihat. Baca merek, model, dan barcode jika terbaca. Jangan menebak informasi yang tidak terlihat."),
    _principal: Principal = Depends(get_principal),
):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="OpenAI Vision belum dikonfigurasi")
    if image.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail="Format gambar harus JPEG, PNG, atau WebP")

    image_bytes = await image.read(MAX_IMAGE_BYTES + 1)
    if not image_bytes:
        raise HTTPException(status_code=400, detail="File gambar kosong")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Ukuran gambar maksimal 10 MB")

    model = os.environ.get("OPENAI_VISION_MODEL", "gpt-4.1-mini")
    image_url = f"data:{image.content_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"
    payload = {
        "model": model,
        "input": [{
            "role": "user",
            "content": [
                {"type": "input_text", "text": question[:1000]},
                {"type": "input_image", "image_url": image_url},
            ],
        }],
        "max_output_tokens": 500,
    }

    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Tidak dapat menghubungi layanan OpenAI") from exc
    if response.is_error:
        raise HTTPException(status_code=502, detail="OpenAI Vision gagal memproses gambar")

    try:
        result = response.json()
        text = "\n".join(
            block.get("text", "")
            for item in result.get("output", [])
            for block in item.get("content", [])
            if block.get("type") == "output_text"
        ).strip()
    except (TypeError, ValueError):
        text = ""
    if not text:
        raise HTTPException(status_code=502, detail="OpenAI tidak mengembalikan hasil analisis")
    return {"text": text, "model": model}