/**
 * Module with functions used for AI formula assistance.
 */

import {delay} from 'app/common/delay';
import log from 'app/server/lib/log';
import fetch, { Response as FetchResponse} from 'node-fetch';


export async function sendForCompletion(prompt: string): Promise<string> {
  let completion: string|null = null;
  if (process.env.OPENAI_API_KEY) {
    completion = await sendForCompletionOpenAI(prompt);
  }
  if (process.env.HUGGINGFACE_API_KEY) {
    completion = await sendForCompletionHuggingFace(prompt);
  }
  if (completion === null) {
    throw new Error("Please set OPENAI_API_KEY or HUGGINGFACE_API_KEY (and optionally COMPLETION_MODEL)");
  }
  log.debug(`Received completion:`, {completion});
  completion = completion.split(/\n {4}[^ ]/)[0];
  return completion;
}


async function sendForCompletionOpenAI(prompt: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set");
  }
  const response = await fetch(
    "https://api.openai.com/v1/completions",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        max_tokens: 150,
        temperature: 0,
        // COMPLETION_MODEL of `code-davinci-002` may be better if you have access to it.
        model: process.env.COMPLETION_MODEL || "text-davinci-002",
        stop: ["\n\n"],
      }),
    },
  );
  if (response.status !== 200) {
    log.error(`OpenAI API returned ${response.status}: ${await response.text()}`);
    throw new Error(`OpenAI API returned status ${response.status}`);
  }
  const result = await response.json();
  const completion = result.choices[0].text;
  return completion;
}

async function sendForCompletionHuggingFace(prompt: string) {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    throw new Error("HUGGINGFACE_API_KEY not set");
  }
  // COMPLETION_MODEL values I've tried:
  //   - codeparrot/codeparrot
  //   - NinedayWang/PolyCoder-2.7B
  //   - NovelAI/genji-python-6B
  let completionUrl = process.env.COMPLETION_URL;
  if (!completionUrl) {
    if (process.env.COMPLETION_MODEL) {
      completionUrl = `https://api-inference.huggingface.co/models/${process.env.COMPLETION_MODEL}`;
    } else {
      completionUrl = 'https://api-inference.huggingface.co/models/NovelAI/genji-python-6B';
    }
  }
  let retries: number = 0;
  let response!: FetchResponse;
  while (retries++ < 3) {
    response = await fetch(
      completionUrl,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            return_full_text: false,
            max_new_tokens: 50,
          },
        }),
      },
    );
    if (response.status === 503) {
      log.error(`Sleeping for 10s - HuggingFace API returned ${response.status}: ${await response.text()}`);
      await delay(10000);
      continue;
    }
  }
  if (response.status !== 200) {
    const text = await response.text();
    log.error(`HuggingFace API returned ${response.status}: ${text}`);
    throw new Error(`HuggingFace API returned status ${response.status}: ${text}`);
  }
  const result = await response.json();
  const completion = result[0].generated_text;
  return completion.split('\n\n')[0];
}
