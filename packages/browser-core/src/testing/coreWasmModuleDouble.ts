import type { CoreWasmModule } from "../webCoreAdapter";

export function createCoreWasmModuleDouble(
  stubs: Partial<CoreWasmModule>
): CoreWasmModule {
  const proxy = new Proxy(stubs, {
    get(target, property, receiver) {
      if (property in target) {
        return Reflect.get(target, property, receiver);
      }
      throw new Error(`CoreWasmModule test double has no stub for "${String(property)}"`);
    }
  });

  return proxy as CoreWasmModule;
}
