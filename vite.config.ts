import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    // Rust-часть не должна попадать в file-watcher Vite: во время `cargo run`
    // линкер держит target/debug/deps/island.exe открытым, и chokidar падает
    // с EBUSY, унося за собой весь `tauri dev`.
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
