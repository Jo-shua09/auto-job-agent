import os

from google import genai
from google.genai import types

DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"


def get_gemini_model() -> str:
    return os.getenv("GEMINI_MODEL", "").strip() or DEFAULT_GEMINI_MODEL


def create_gemini_client(api_key: str) -> genai.Client:
    return genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(api_version="v1beta"),
    )
