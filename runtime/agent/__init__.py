"""CactusStrudel Agent v3: direct CLIProxy settings and durable Brain jobs."""

from .capabilities import RECOMMENDED_BRAIN_MODEL_ID
from .cliproxy import CLIProxyClient
from .job_store import BrainJobStore
from .keychain import MacOSKeychainStore
from .models import AgentProfile, SCHEMA_VERSION
from .responses_runner import BrainRunnerService
from .settings import AgentSettingsService, AgentSettingsStore
from .tools import ToolRegistry, ToolSpec
from .ultra import BoundedUltraCoordinator

__all__ = [
    "AgentProfile",
    "CLIProxyClient",
    "BrainJobStore",
    "BrainRunnerService",
    "BoundedUltraCoordinator",
    "MacOSKeychainStore",
    "RECOMMENDED_BRAIN_MODEL_ID",
    "SCHEMA_VERSION",
    "AgentSettingsService",
    "AgentSettingsStore",
    "ToolRegistry",
    "ToolSpec",
]
