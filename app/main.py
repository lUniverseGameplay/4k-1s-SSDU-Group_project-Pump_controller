"""FastAPI application entry point."""

from fastapi import FastAPI

from app.endpoints import router as analysis_router

app = FastAPI()
app.include_router(analysis_router)

@app.get("/")
def read_root():
    return {"message": "Hello, World!"}