import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from limits import LimitsMiddleware
from routes import upload, export, tools, ai

app = FastAPI(title="PDFForge API", version="5.0")

import os
origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "localhost:5173").split(",") if o.strip()]
app.add_middleware(LimitsMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET","POST","OPTIONS"], allow_headers=["*"])

app.include_router(upload.router, prefix="/api/upload")
app.include_router(export.router, prefix="/api/export")
app.include_router(tools.router,  prefix="/api/tools")
app.include_router(ai.router,     prefix="/api/ai")

@app.get("/")
def root():
    return {"name": "PDFForge API", "version": "5.0", "status": "running"}

@app.get("/api/health")
def health():
    return {"status": "ok", "version": "5.0"}
