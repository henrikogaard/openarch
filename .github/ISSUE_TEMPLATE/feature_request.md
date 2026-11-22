name: Feature request
about: Propose a change to the product
labels: enhancement
body:
  - type: textarea
    id: problem
    attributes:
      label: What problem does this solve?
      description: Describe the workflow or pain point today, not the solution yet. Link the roadmap section if one exists (docs/roadmap.md).
      placeholder: |
        As a <platform architect / EA / Archi user>, today I have to … which is painful because …
    validations:
      required: true
  - type: textarea
    id: proposal
    attributes:
      label: What should change?
      description: Your proposed behaviour. Keep it to the user-visible outcome; implementation detail belongs in the discussion.
    validations:
      required: true
  - type: dropdown
    id: audience
    attributes:
      label: Which audience does this serve?
      options:
        - Infrastructure/cloud (Tier A)
        - Archi/ArchiMate users (Tier B)
        - TOGAF/enterprise EA (Tier C)
        - All / not tier-specific
  - type: textarea
    attributes:
      label: Non-goals and constraints
      description: Checked the roadmap §"What not to do next" and AGENTS.md §13 — anything here that overlaps? Alternatives you've ruled out?
  - type: textarea
    attributes:
      label: Anything else?
      description: Prior art (Archi/other tools), acceptance criteria, doctrine-critical details.
