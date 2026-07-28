"""Typed failures for the CactusStrudel Agent v3 boundary."""


class AgentV3Error(RuntimeError):
    """Base class for failures that should be shown to the product UI."""


class ConfigurationError(AgentV3Error):
    """The draft or active Agent profile is incomplete or unsupported."""


class CredentialError(AgentV3Error):
    """The requested Keychain credential is missing or inaccessible."""


class CLIProxyError(AgentV3Error):
    """A direct CLIProxyAPI request failed."""

    def __init__(self, message: str, *, status: int | None = None):
        super().__init__(message)
        self.status = status


class DraftConflict(AgentV3Error):
    """The draft changed since the caller read it (compare-and-swap)."""


class ApplyError(AgentV3Error):
    """A draft cannot be promoted to active configuration."""


class JobError(AgentV3Error):
    """A durable Brain job failed."""


class JobCancelled(JobError):
    """A Brain job was cancelled before a mutation committed."""


class CancelledAfterCommit(JobCancelled):
    """Cancellation arrived after an external mutation committed."""


class ToolRegistrationError(AgentV3Error):
    """A tool violates the selected Brain workspace contract."""


class ToolExecutionError(JobError):
    """A declared tool could not be executed."""


class UltraUnavailable(ConfigurationError):
    """Ultra was selected without an available bounded coordinator."""
