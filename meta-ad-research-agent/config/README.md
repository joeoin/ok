# Configuration

All runtime configuration is environment-driven: copy `../.env.example` to `../.env` and edit it. `src/config.ts` validates every variable with zod and applies defaults, so a missing or malformed value fails fast with a clear message.

This folder is reserved for future file-based configuration (e.g. batch research lists, per-source scraper profiles, integration credentials mappings) so that adding them doesn't change the loader's public interface.
