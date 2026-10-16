# 先看额度再派活

```
派活前先运行 `crew quota --json`（只读本机记录，不耗额度）。
- 只派给 status 为 green 或 yellow 的员工（用 --workers 指定）；yellow 表示只剩试用期模型，结论要更仔细复核。
- 全部 red：不要派活也不要 crew reset，把每个员工 cooling[].reset_at 里最早的恢复时间告诉我。
- gray 只是没数据，可以试一次。
然后执行：<任务>
```
