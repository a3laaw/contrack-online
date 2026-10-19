import { plugin } from "bun";
plugin({
  name: "stub-server-only",
  setup(b) {
    b.module("server-only", () => ({ exports: {} }));
  },
});
