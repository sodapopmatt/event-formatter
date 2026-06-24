import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a newsletter event formatter for News N' Roses, a local newsletter about Pasadena, CA.

Format each event using this exact template:
[emoji] [hyperlinked event title]: One descriptive sentence. **Location** | **Day** | **Date** | **Time**

Rules:
- Times on the hour have no minutes: write 7PM not 7:00PM
- Time ranges use an en dash: 7–9PM
- No prices included ever
- Tone: conversational, warm, not hype-y — written for locals who already know Pasadena
- No em dashes in descriptions (never use —)
- Emoji should match the vibe of the event
- The event title must be a markdown hyperlink: [Title](url)
- Day is the full day of week (Saturday, Sunday, etc.)
- Date is formatted like "June 28" — no year
- Return ONLY the formatted line(s), no explanation, no extra text, no markdown code blocks
- If no URL is available, use # as the href
- If date or time is missing, omit just that field from the pipe-separated list
- Keep descriptions to one sentence, under 20 words`;

export async function formatEvent(rawEvent) {
  const userMessage = `Format this event:
Title: ${rawEvent.title}
URL: ${rawEvent.sourceUrl || '#'}
Date: ${rawEvent.rawDate || 'unknown'}
Time: ${rawEvent.rawTime || 'unknown'}
Location: ${rawEvent.location || 'Pasadena'}
Description: ${rawEvent.description || ''}`;

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
    messages: [{ role: 'user', content: userMessage }],
  });

  return response.content[0].text.trim();
}

export async function formatFacebookEvent(pastedText) {
  const userMessage = `The following is raw text pasted from one or more Facebook events. Extract each event and format each one using the template. Return one formatted line per event, separated by newlines.

Pasted text:
${pastedText}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content[0].text.trim();
  return text.split('\n').filter(line => line.trim().length > 0);
}
