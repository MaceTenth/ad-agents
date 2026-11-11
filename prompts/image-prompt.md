# The image prompt

The image model never sees the owner's message or the agent's reasoning. It sees one block of text that your service composes from three layers. Each layer has a different owner, which is why they are kept apart.

| Layer | Who writes it | How often it changes | Where it comes from |
|---|---|---|---|
| Brand | You, once | When the brand changes | The "Picture style" section of `brand-sheet.md` |
| Scene | The research agent | Every ad | `image.scene` in the brief |
| Format | Your code | Per channel | `image.aspect`, `image.text_in_image`, `image.avoid` |

## Template

```text
{{ BRAND LAYER }}

{{ SCENE LAYER }}

{{ FORMAT LAYER }}
```

### Brand layer

Written by hand, once, from the brand sheet. It is the same in every ad, which is what makes ten ads look like one bakery.

```text
A photograph for a neighbourhood bakery's social media. Natural morning light
from a window, warm tones, shallow depth of field. Wooden counter, linen cloth,
a little flour on the surface. The food looks real and handmade, slightly
imperfect, never plastic or glossy. Colours stay within cream, wheat gold and
deep brown, with a single terracotta accent.
```

### Scene layer

`image.scene` from the accepted brief, unchanged. Example:

```text
Two braided challah loaves, golden and glossy with sesame seeds, resting side
by side on a floured wooden counter. A linen cloth is folded under one end.
Soft light comes from a window on the left and catches a little steam rising
from the nearer loaf. Behind them, out of focus, a bakery shelf and a paper
bag ready to go. Shot from a low three-quarter angle, close, so the loaves
fill most of the frame. Calm, warm, early Friday morning.
```

### Format layer

Built by code from three fields of the brief.

When `text_in_image` is empty:

```text
{{ Square | Vertical | Wide }} composition with the subject centred and a little
room at the edges for cropping. No text, letters, numbers, logos or watermarks
anywhere in the image. Do not include: {{ avoid, joined with commas }}.
```

When `text_in_image` has words:

```text
{{ Square | Vertical | Wide }} composition with the subject centred and a little
room at the edges for cropping. Render this text once, exactly as written,
large and clearly legible: "{{ text_in_image }}". No other text, letters,
numbers, logos or watermarks. Do not include: {{ avoid, joined with commas }}.
```

Image models still make mistakes with exact text, and more often in Hebrew. The default in this pipeline is no text in the picture. The caption carries the words.

## One brief, two providers

`aspect` is your word. Each adapter translates it into the provider's own setting.

| `aspect` | OpenAI `size` | Nano Banana `aspect_ratio` |
|---|---|---|
| `square` | `1024x1024` | `1:1` |
| `portrait` | `1024x1536` | `2:3` |
| `landscape` | `1536x1024` | `3:2` |

OpenAI adapter. The response is always base64, so there is no URL to download.

```python
import base64
from openai import OpenAI

client = OpenAI()  # reads OPENAI_API_KEY

SIZES = {"square": "1024x1024", "portrait": "1024x1536", "landscape": "1536x1024"}

def draw(prompt: str, aspect: str) -> bytes:
    result = client.images.generate(
        model="gpt-image-2.6-sunburst",
        prompt=prompt,
        size=SIZES[aspect],
        quality="medium",
        output_format="jpeg",
    )
    return base64.b64decode(result.data[0].b64_json)
```

Nano Banana adapter. Same input, same output, different provider.

```python
import base64
from google import genai

client = genai.Client()  # reads GEMINI_API_KEY

RATIOS = {"square": "1:1", "portrait": "2:3", "landscape": "3:2"}

def draw(prompt: str, aspect: str) -> bytes:
    interaction = client.interactions.create(
        model="gemini-nano-banana-2.1",
        input=prompt,
        response_format={
            "type": "image",
            "mime_type": "image/jpeg",
            "aspect_ratio": RATIOS[aspect],
            "image_size": "1K",
        },
    )
    return base64.b64decode(interaction.output_image.data)
```

Both functions take a prompt and an aspect and return JPEG bytes. That shared shape is the adapter contract from the lesson. The rest of the service calls `draw` and never learns which company answered.

JPEG is requested on purpose. WhatsApp accepts JPEG and PNG up to 5 MB, and a 1024-pixel JPEG is far below that.

Model names and parameters were checked against each provider's official documentation on 2026-11-11. Image models are renamed and retired often, so check the names again before you teach or deploy.
