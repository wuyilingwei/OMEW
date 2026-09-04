# 调研记录

- [现象] `instanceDomain(env)` 仅读取 `INSTANCE_DOMAIN`，空值即回退 `local`；WebAuthn 随之使用 `localhost`。
  -> [结论] 公开且无自定义域的 workers.dev 部署会产生错误 actor 域与 RP ID/origin。
- [路径] API Worker 将原始 `Request` 直接传给 `ROOM_DO.fetch(request)` 与 `STRONGHOLD_DO.fetch(request)`。
  -> [结论] Cloudflare Durable Objects 官方文档明确允许将原始 Request 传给 stub.fetch；DO fetch 收到该 Request，因此可在 WS 握手中读取真实 URL。后续 `webSocketMessage` 没有 Request，需把已验证的实例域存进 socket attachment。
- [StrongholdDO] `revokeActor` 是 DO/RPC 内部调用，没有 HTTP Request。
  -> [结论] 据点 owner actor 在创建时已是实例本地域，可作为该 DO 的稳定本地域基准，避免依赖空环境变量。
