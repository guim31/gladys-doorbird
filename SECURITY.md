# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes. In
particular:

- **Secrets**: the passwords of the DoorBird users live in the Gladys
  configuration of the integration (`secret` fields). They travel only to the
  configured DoorBirds, in the HTTP Basic `Authorization` header (never in a
  URL), and are never written to the logs, to `/data`, to an error message or
  to the stream address shown to the user. An address typed with credentials
  (`user:pass@host`) is refused. A password refused once is never tried again
  without the user. Over plain HTTP, the LAN carries the Basic credentials
  readable: use a dedicated DoorBird user with only the permissions it needs,
  or an `https://` address.
- **`/data`**: the only file is `doorbird-state.json`: the identity of each
  DoorBird (MAC address, model, firmware, relays). No secret, no image.
- **Network**: the integration talks only to the configured addresses (HTTP,
  or HTTPS when the address starts with `https://`; a DoorBird only has a
  self-signed certificate, which is then accepted), never to a cloud. It opens
  no port: the events come over an outgoing connection.
- **Safety**: opening a door is disabled by default and is never a device
  feature, a widget button or a configuration action — only a scene action,
  once allowed, for a relay the DoorBird lists, sent once and never retried.
- **Camera images** stay in memory (the last ones, for the widget) and go to
  Gladys only.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the DoorBird devices and their firmware (report those to Bird Home
Automation).
