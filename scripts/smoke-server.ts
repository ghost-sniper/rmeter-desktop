const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 18765,
  fetch(request) {
    return Response.json({
      ok: true,
      method: request.method,
      path: new URL(request.url).pathname,
    });
  },
});
console.log(`本地示例服务已启动：${server.url}`);
