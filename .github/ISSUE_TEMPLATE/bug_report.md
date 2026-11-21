name: Bug report
about: Something is wrong with the app, CLI, server, or MCP
labels: bug
body:
  - type: textarea
    id: what-happened
    attributes:
      label: What happened?
      description: A clear description of the defect, plus what you expected instead.
    validations:
      required: true
  - type: textarea
    id: repro
    attributes:
      label: Steps to reproduce
      description: The smallest sequence that reproduces it. Include a minimal model (AOEF .xml / native .json) if possible.
      placeholder: |
        1. Open a workspace with …
        2. …
    validations:
      required: true
  - type: textarea
    attributes:
      label: Environment
      description: Run `npx openarch doctor` (CLI path) or paste browser + OS versions.
    validations:
      required: true
  - type: dropdown
    id: area
    attributes:
      label: Which surface is affected?
      options:
        - Web editor (local mode)
        - Web editor (server mode)
        - Self-hosted server / REST API
        - CLI (openarch)
        - MCP server
        - Import/export (AOEF, .archimate, C4, draw.io)
        - Other
    validations:
      required: true
  - type: textarea
    attributes:
      label: Anything else?
      description: Screenshots, console output, and the output of `nom run doctor` if relevant.
