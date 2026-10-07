import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a newsletter event formatter for News N' Roses, a local newsletter about Pasadena, CA.

Format each event using this exact template:
[emoji] [hyperlinked event title]: One descriptive sentence. **Location** | **Day** | **Date** | **Time**

The description is the whole job. Its purpose is to tell a local reader what will actually happen at this event, using the specific details in the source text — not to sell them on attending.

How to write the description:
- Pull 1-2 concrete, specific facts from the source description: who's performing or hosting, what's on display, what activity happens, what's included, what makes this particular event different from a generic version of it. If the source names a band, artist, dish, theme, film, speaker, or activity, use that name.
- If the source material is thin, empty, or generic, write a short plain sentence from what the title and venue tell you (e.g. "A fall festival in the Japanese garden's historic Shoya House." or "A Halloween evening event at Descanso Gardens."). Don't invent specifics, and don't paper over the gap with enthusiasm.
- This text is published directly to readers. Never mention the source, the description, missing or unavailable details, or what you were or weren't given. Never write notes, caveats, apologies, or anything addressed to the editor.
- Write it as you'd describe the event to a friend deciding whether to go: plain, factual, specific. Not as an ad.
- Never use these words/phrases or their close variants: join us, don't miss, come celebrate, experience the, indulge, elevate, immerse yourself, unforgettable, vibrant, must-see, get ready, gather for, in for a treat, whether you're a ... or a .... These are filler that could describe any event and read as AI-generated.
- No exclamation points.
- Bad (generic/promotional): "Join us for a fun-filled evening of live music and entertainment!" Good (specific): "Local jazz trio The Bluebirds plays standards on the patio."
- Bad (generic): "Enjoy a variety of delicious food and drinks at this vibrant community event." Good (specific): "Food trucks and a beer garden set up alongside a used book sale benefiting the library."

Rules:
- Times on the hour have no minutes: write 7PM not 7:00PM
- Time ranges use an en dash: 7–9PM
- No prices included ever
- Tone: conversational, warm, not hype-y — written for locals who already know Pasadena
- No em dashes in descriptions (never use —)
- Emoji should match the vibe of the event
- The event title must be a markdown hyperlink: [Title](url), unless the URL is "none"
- Day is the full day of week (Saturday, Sunday, etc.)
- Date is formatted like "June 28" — no year
- Return ONLY the formatted line(s), no explanation, no extra text, no markdown code blocks
- If the URL is "none", write the title as plain text with no brackets or link
- Never link to pasadenanow.com under any circumstances
- If date or time is missing, omit just that field from the pipe-separated list
- Keep descriptions to one sentence, under 20 words`;

// Never link to Pasadena Now; with no real link, the title is plain text
const DEAD_LINK = /\[([^\]]+)\]\((?:#|none|(?:https?:\/\/)?(?:[\w-]+\.)*pasadenanow\.com[^)]*)\)/gi;

function safeUrl(url) {
  return !url || /pasadenanow\.com/i.test(url) ? 'none' : url;
}

export async function formatEvent(rawEvent) {
  const userMessage = `Format this event:
Title: ${rawEvent.title}
URL: ${safeUrl(rawEvent.sourceUrl)}
Date: ${rawEvent.rawDate || 'unknown'}
Time: ${rawEvent.rawTime || 'unknown'}
Location: ${rawEvent.location || 'Pasadena'}
Description: ${rawEvent.description || ''}`;

  const hasMetaText = (l) => META_TEXT.test(splitLine(l, rawEvent.title).description);

  let line = await requestLine([{ role: 'user', content: userMessage }]);

  // Retry once if the model wrote commentary instead of a reader-facing description
  if (hasMetaText(line)) {
    console.warn(`[Formatter] Meta text in "${rawEvent.title}", retrying: ${line}`);
    line = await requestLine([
      { role: 'user', content: userMessage },
      { role: 'assistant', content: line },
      { role: 'user', content: 'That description talks about the source or missing details. This is published to readers. Rewrite the line with a plain sentence about the event based on its title and venue, and never mention the source or what information is or isn\'t available.' },
    ]);
  }

  // Still bad: publish the line without a description rather than chat text
  if (hasMetaText(line)) {
    console.warn(`[Formatter] Meta text persisted in "${rawEvent.title}", dropping description: ${line}`);
    const { head, details } = splitLine(line, rawEvent.title);
    line = `${head} ${details}`;
  }

  return line;
}

// Phrases that only show up when the model talks about its input instead of the event
const META_TEXT = new RegExp([
  /\b(the|this) (provided |given |original )?(source|description|listing)\b/,
  /\b(the|this) (provided|given) (text|information|info)\b/,
  /\bbased on the (title|name|venue)\b/,
  /\bdetails? (were|was|are|is)(n't| not) (available|provided|included|given|specified|listed)/,
  /\b(no|limited|few|specific) (details|information|description)\b/,
  /\b(not|isn't|aren't|wasn't|weren't) (specified|mentioned|provided|available|included|listed|clear)\b/,
  /\b(unclear|unspecified|unavailable)\b/,
  /\bI (don't|do not|can't|cannot|couldn't|could not|am unable)\b/,
  /\b(unfortunately|apologi[sz]e|sorry)\b/,
].map(r => r.source).join('|'), 'i');

async function requestLine(messages) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages,
  });
  return response.content[0].text.trim().replace(DEAD_LINK, '$1');
}

// Split "emoji Title: description. **Location** | ..." into
// { head: "emoji Title:", description: "description.", details: "**Location** | ..." }
function splitLine(line, title) {
  const boldStart = line.indexOf('**');
  const bodyEnd = boldStart === -1 ? line.length : boldStart;
  const titleAt = title ? line.indexOf(title) : -1;
  const linkEnd = line.indexOf(')', titleAt);
  // Start looking for the colon after the title (and its link, if any)
  let from = titleAt === -1 ? 0 : titleAt + title.length;
  if (line[from] === ']' && linkEnd !== -1) from = linkEnd;
  const colon = line.indexOf(':', from);
  if (colon === -1 || colon >= bodyEnd) {
    return { head: line.slice(0, bodyEnd).trim(), description: '', details: line.slice(bodyEnd) };
  }
  return {
    head: line.slice(0, colon + 1),
    description: line.slice(colon + 1, bodyEnd).trim(),
    details: line.slice(bodyEnd),
  };
}
