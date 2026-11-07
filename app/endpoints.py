"""HTTP endpoints for analyzing uploaded pump recordings."""

from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.core import AnalysisError, analyze_json

router = APIRouter(prefix="/api", tags=["analysis"])


@router.post("/analyze")
async def analyze_file(file: UploadFile = File(...)) -> dict[str, Any]:
    """Validate and analyze a UTF-8 JSON file containing pump sensor samples."""
    try:
        return analyze_json(await file.read())
    except AnalysisError as error:
        raise HTTPException(
            status_code=422,
            detail={
                "status": "format_error",
                "category": error.category,
                "message": str(error),
                "totals": None,
            },
        ) from error
    finally:
        await file.close()
