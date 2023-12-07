# platform-discord

[Discord](https://discord.com) is a chat app that was originally marketed
towards gamers, but has since pivoted into being a general communication
platform. Real-time data is carried via WebSocket ("Gateway") and requests occur
over bog-standard REST HTTP.

Generally speaking, users and bots communicate with the service much in the same
way (Gateway/HTTP), which means that it's OK to read official bot documentation
to get a rough idea of how things work. However, the API surface that user
accounts use are (obviously) much different than the one bots leverage.

Therefore, when interacting with user accounts, it's advisable to take Discord's
documentation with a grain of salt and simply observe what the official client
does most of the time. Despite this, many underlying details are nevertheless
identical.

## Pretending to be first-party

- TL;DR: **Observe with first-party clients do and mimic them to a tee.**
- Always send the `X-Super-Properties` header in HTTP requests. Likewise, send
  this data appropriately when `IDENTIFY`ing.
- Use the same `User-Agent` that a first-party client would.
- Do not use an off-the-shelf Discord library with a user account.
  - It's really suspicious to send the `intents` field when logging in as a
    user&mdash;it's something that only bots have to care about.
- Stick to first-party ratelimits. Don't be overzealous with HTTP requests.
- It's probably advisable to be connected to the gateway before sending HTTP
  requests.<sup>(unverified)</sup>

## Tripping Discord's anti-spam measures

If you send enough suspicious requests to surpass some threshold unbeknownst to
us, your account is either instantly disabled or flagged. Being flagged involves
receiving a gateway `DISPATCH` event of type `USER_REQUIRED_ACTION_UPDATE`, with
`required_action` being `"REQUIRE_VERIFIED_PHONE"`. The account becomes
effectively unusable until a ~legitimate phone number (that isn't being used
with another account) is associated with it and verified via SMS. In Discord's
first party clients, the entire screen is obscured with a prompt to go through
this verification flow.

Being flagged is inherently infectious in that it can not only occur to an
account, but even to a phone number or IP.

## Risky actions

Certain endpoints are particularly sensitive to anti-spam heuristics.
[This issue from the Discord-S.C.U.M project](https://github.com/Merubokkusu/Discord-S.C.U.M/issues/66#issue-876713938)
documents some known examples:

- [Creating new DM channels](https://github.com/Merubokkusu/Discord-S.C.U.M/issues/41)
- Sending friend requests
- Joining guilds

Extra caution is essential with these endpoints; account termination or flagging
can occur should you trip Discord's anti-spam measures. It's best to avoid these
entirely, if possible.

## Useful links

- [Official Discord Documentation](https://discord.com/developers/docs/)
- [discord-unofficial-docs](https://luna.gitlab.io/discord-unofficial-docs/):
  Partial documentation of Discord's private APIs.
- [Discord-S.C.U.M](https://github.com/Merubokkusu/Discord-S.C.U.M): A wrapper
  for userbots/selfbots in Python.
- [`capabilities` field](https://gist.github.com/dolfies/a8c27cdd1c77fb8b45313197fed5540a):
  Partial documentation of the `capabilities` field sent while `IDENTIFY`ing,
  which is actually a bitfield that affects what data is sent through the
  gateway, and which shape it takes on.
