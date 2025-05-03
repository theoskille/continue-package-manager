import { Dependency } from "../types";

export async function getPackageInfo(dep: Dependency): Promise<any> {
  if (!dep.name || !dep.version) {
    throw new Error("Invalid dependency object");
  }
  const absoluteVersion = (
    dep.version.startsWith("^") ? dep.version.slice(1) : dep.version
  ).split(" ")[0];
  const resp = await fetch(
    `https://registry.npmjs.org/${dep.name}/${absoluteVersion}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    }
  );
  const data = await resp.json();
  return data;
}

export async function getPackageMetadata(name: string): Promise<any> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${name}`);
    const data = await res.json();
    return data;
  } catch(error) {
    throw new Error(`Failed to fetch package info for ${name}: ${error}`);
  }
}
