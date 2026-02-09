# Verified Argument Maps - repeatable commands

# Parse argdown to JSON
json:
    npx @argdown/cli json example.argdown .

# Verify + render enriched HTML (single step, like quarto render)
render: json
    uv run --with sympy --with networkx python argmap.py example.json example_verified.html

# Render argument map to SVG/PDF (argdown CLI)
map:
    npx @argdown/cli map example.argdown .

# Full pipeline
all: render map
