# 首页 Overture 部署入口调研

- [OMEW 当前首页] -> “最近更新”下方卡片仍引导访客查看 OMEW 项目源码，没有浏览器部署入口 -> 直接替换该卡片的定位、文案与链接。
- [OMEW 当前 README] -> Overture 链接指向 `github.com/wuyilingwei/overture`，要求访客自行打开部署实例并填写来源 -> 这不是面向最终用户的一键部署路径。
- [EdgeSonic 参考] -> README 与产品页统一使用 `https://overture.demo-w10v.workers.dev/?src=wuyilingwei%2Fedgesonic` -> OMEW 应使用相同在线部署器并将 `src` 预选为 `wuyilingwei/OMEW`。
- [首次本地验证失败] -> 隔离 worktree 没有安装依赖，`vitest`、`tsc` 与 `vue-tsc` 均返回 command not found -> 按锁文件安装依赖后重跑，不修改依赖声明。
- [契约测试首次运行失败] -> Cloudflare Vitest pool 中通过 Node `fs` 读取仓库 README 被虚拟运行时隔离，报告文件不存在 -> 改用 Vite `?raw` 导入静态文本，保持测试不依赖宿主文件系统 API。
- [类型检查首次运行失败] -> 未先生成 Wrangler 的 `server/worker-configuration.d.ts`，导致 Worker 全局类型与 bindings 全部缺失 -> 按项目 `verify` 顺序先运行服务端 `types` 再重跑类型检查。
- [全量测试旧契约失败] -> 既有首页测试仍强制要求源码仓库 URL，与用户要求的新部署入口冲突 -> 保留 AGPL 与非商业美术边界文案，将链接断言更新为预选 OMEW 的在线 Overture 地址。
- [在线部署器验收] -> 直接打开带 `src=wuyilingwei%2FOMEW` 的 Overture 地址，使用条款后第 2 步自动显示 `wuyilingwei/OMEW`，并加载推荐版本 `v1.0.0` -> 预选来源参数有效。
- [本地首页验收] -> 生产构建预览显示“部署属于自己的 OMEW”“使用 Overture 部署”，链接目标为预选 OMEW 的在线部署器，原源码项目按钮不存在 -> 首页交互与文案符合要求；静态预览未启动 API Worker，因此目录请求失败属于验收环境预期。
