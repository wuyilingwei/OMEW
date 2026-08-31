# Findings

- Overture recipe 通过 `ctx.secrets.putHostValue(name)` 将宿主收集的值注入部署后 Worker Secret；该调用只能传 secret 名称，recipe 不读取凭证。
- OMEW 的运行时自更新接口需要 `CF_ACCOUNT_ID` 与 `CF_API_TOKEN`，其中 token 权限采用 `workers_scripts/edit` 的 host secret 声明。
- OMEW 版本分布在根、server、web package.json，以及打包脚本的默认 tag/version。
