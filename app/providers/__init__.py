from app.providers.base import Provider, ProviderError
from app.providers.comfyui import ComfyUIProvider
from app.providers.openai_compatible import OpenAICompatibleProvider
from app.providers.tuzi_image import TuziImageProvider
from app.providers.tuzi_video import TuziSoraProvider, TuziVeoProvider
from app.providers.vertex_veo import VertexVeoProvider

PROVIDER_TYPE_REGISTRY: dict[str, type[Provider]] = {
    "comfyui": ComfyUIProvider,
    "openai_compatible": OpenAICompatibleProvider,
    "tuzi_image": TuziImageProvider,
    "tuzi_sora": TuziSoraProvider,
    "tuzi_veo": TuziVeoProvider,
    "vertex_veo": VertexVeoProvider,
}

__all__ = [
    "Provider",
    "ProviderError",
    "ComfyUIProvider",
    "OpenAICompatibleProvider",
    "TuziImageProvider",
    "TuziSoraProvider",
    "TuziVeoProvider",
    "VertexVeoProvider",
    "PROVIDER_TYPE_REGISTRY",
]
