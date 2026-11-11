# The kickoff message

This is the first message your service sends into a new session. The agent is generic. Everything that makes the ad about this business arrives here, as data, in three blocks.

## Template

```text
<brand_sheet>
{{ the full text of prompts/brand-sheet.md }}
</brand_sheet>

<facts>
Today: {{ weekday }} {{ YYYY-MM-DD }}. Time zone: {{ IANA time zone }}.
Branch: {{ the branch this owner manages, or "all branches" }}
Opening hours: {{ hours for that branch, from your records }}
Products and prices: {{ name and price, from your records }}
</facts>

<request>
{{ the owner's WhatsApp text, word for word }}
</request>
```

Three rules for whoever fills it in:

1. **`<facts>` comes from your database, never from the message.** The service looks up prices and hours with a query. These are the only business facts the agent may state, so a missing fact means a missing claim, which is the safe direction.
2. **Always send today's date.** The model does not know what day it is. Without the date it cannot work out what "Friday" means.
3. **`<request>` is copied, not cleaned.** Do not translate, correct or summarise the owner's words. The agent answers in the language it finds there.

## Filled example

The prices are the ones used all through the course. The opening hours are sample data.

```text
<brand_sheet>
... prompts/brand-sheet.md goes here ...
</brand_sheet>

<facts>
Today: Wednesday 2026-11-11. Time zone: Asia/Jerusalem.
Branch: Tel Aviv - Florentin
Opening hours: Sunday to Thursday 06:30-20:00, Friday 07:00-14:00, Saturday closed.
Products and prices: Challah ₪18, Babka ₪42, Sourdough loaf ₪28, Rugelach (box) ₪32, Croissant ₪12, Cappuccino ₪14, Cheese bourekas ₪10, Cinnamon roll ₪14.
</facts>

<request>
מודעה ליום שישי: חלות, 2 ב-30, פלורנטין
</request>
```

## The revision message

When the owner answers a draft, send their reply into the **same session**. The agent still remembers the brand sheet, the facts and its last brief, so the message is tiny.

```text
<reply>
{{ the owner's WhatsApp reply, word for word }}
</reply>
```

Examples of replies the agent handles: "קצר יותר", "another image", "make it about the babka", "בלי אימוג'י".

Two replies never reach the agent, because the service answers them itself:

| The owner writes | The service does |
|---|---|
| `ok` or `👍` | Marks the job approved and replies "Saved." Nothing is posted for her. |
| `stop` | Closes the job. The next message starts a new session. |

## What the service answers to `submit_ad_brief`

The tool result is plain text, and it is a prompt too: the agent reads it and acts on it. Keep it short and specific.

```text
accepted
```

```text
rejected
- copy.caption is 688 characters. The limit is 600.
- copy.caption states "₪25", which is not in facts_used. Use only prices from <facts> or <request>.
- image.scene is in Hebrew. Write the scene in English.
```

Name the field, say what is wrong and say what would be right. "Invalid brief" teaches the agent nothing and costs you another round.
