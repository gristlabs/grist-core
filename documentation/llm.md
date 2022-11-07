# Using Large Language Models with Grist

In this experimental branch of Grist, originally developed by Alex Hall,
you can hook up an AI model such as OpenAI's Codex to write formulas for
you. Here's how.

First, you need an API key. You'll have best results currently with an
OpenAI model. Visit https://openai.com/api/ and prepare a key, then
store it in an environment variable `OPENAI_API_KEY`.

Alternatively, there are many non-proprietary models hosted on Hugging Face.
At the time of writing, none can compare with OpenAI for use with Grist.
Things can change quickly in the world of AI though. So instead of OpenAI,
you can visit https://huggingface.co/ and prepare a key, then
store it in an environment variable `HUGGINGFACE_API_KEY`.

That's all the configuration needed! Run Grist as usual and there should
be a new option to generate formulas, as in demo videos.

## Trying other models

The model used will default to `text-davinci-002` for OpenAI. You can
get better results by setting an environment variable `COMPLETION_MODEL` to
`code-davinci-002` if you have access to that model.

The model used will default to `NovelAI/genji-python-6B` for
Hugging Face. There's no particularly great model for this application,
but you can try other models by setting an environment variable
`COMPLETION_MODEL` to `codeparrot/codeparrot` or
`NinedayWang/PolyCoder-2.7B` or similar.

If you are hosting a model yourself, host it as Hugging Face does,
and use `COMPLETION_URL` rather than `COMPLETION_MODEL` to
point to the model on your own server rather than Hugging Face.
