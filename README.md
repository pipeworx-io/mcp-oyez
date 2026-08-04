# mcp-oyez

Oyez SCOTUS MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `search_cases` | Search US Supreme Court (SCOTUS) cases from Oyez by term year and/or case-name substring. Returns compact summaries with the question presented, description, and IDs for get_case. If neither term nor name is given, defaults to the most recent term. Keyless. |
| `get_case` | Get a full SCOTUS case from Oyez by term and docket number — question presented, facts, conclusion, decision (winning party, vote split, decision type), which justices were in the majority vs. dissent, advocates, and whether oral-argument audio exists. Keyless. |
| `cases_by_term` | List the SCOTUS cases for a given term year from Oyez — compact summaries (name, docket, citation, short question, oyez_url). Use to browse a full term. Keyless. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "oyez": {
      "url": "https://gateway.pipeworx.io/oyez/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Oyez data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
