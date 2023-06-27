# Using Large Language Models with Grist

In this experimental Grist feature, originally developed by Alex Hall,
you can hook up OpenAI's ChatGPT to write formulas for
you. Here's how.

First, you need an API key. Visit https://openai.com/api/ and prepare a key, then
store it in an environment variable `OPENAI_API_KEY`.

That's all the configuration needed!

Currently it is only a backend feature, we are still working on the UI for it.

## Hugging Face and other OpenAI models (deactivated)

_Not currently available, needs some work to revive. These notes are only preserved as a reminder to ourselves of how this worked._

~~To use a different OpenAI model such as `code-davinci-002` or `text-davinci-003`,
set the environment variable `COMPLETION_MODEL` to the name of the model.~~

~~Alternatively, there are many non-proprietary models hosted on Hugging Face.
At the time of writing, none can compare with OpenAI for use with Grist.
Things can change quickly in the world of AI though. So instead of OpenAI,
you can visit https://huggingface.co/ and prepare a key, then
store it in an environment variable `HUGGINGFACE_API_KEY`.~~

~~The model used will default to `NovelAI/genji-python-6B` for
Hugging Face. There's no particularly great model for this application,
but you can try other models by setting an environment variable
`COMPLETION_MODEL` to `codeparrot/codeparrot` or
`NinedayWang/PolyCoder-2.7B` or similar.~~

~~If you are hosting a model yourself, host it as Hugging Face does,
and use `COMPLETION_URL` rather than `COMPLETION_MODEL` to
point to the model on your own server rather than Hugging Face.~~
