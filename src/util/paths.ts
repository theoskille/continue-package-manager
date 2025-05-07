import fs from "fs";
import path from "path";
import { DEFAULT_PACKAGE_JSON } from "./packageJson";
import { PackageLock, PackageLockEntry } from "../commands/install/TODO";

export const outputDir = path.join(process.cwd(), "output");
export const packageJsonPath = path.join(outputDir, "package.json");
export const packageLockJsonPath = path.join(outputDir, "package-lock.json");
export const nodeModulesPath = path.join(outputDir, "node_modules");
export const globalCachePath = path.join(process.cwd(), "global-cache");
export const cacheManifestPath = path.join(globalCachePath, "manifest.json");

export function setupFreshOutputDir() {
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, {
      force: true,
      recursive: true,
    });
  }

  fs.mkdirSync(outputDir);
  fs.mkdirSync(nodeModulesPath);
  fs.writeFileSync(
    packageJsonPath,
    JSON.stringify(DEFAULT_PACKAGE_JSON, undefined, 2)
  );
}

export function writePackageLock(
  packageLock: PackageLock,
) {
  try {
    fs.writeFileSync(
        packageLockJsonPath,
        JSON.stringify(packageLock, undefined, 2)
      );
    console.log(`Successfully wrote package-lock.json to ${packageLockJsonPath}`);
  } catch (error) {
    console.error('Failed to write package-lock.json:', error);
    throw error;
  }
}

export function packageLockExists(): boolean {
  return fs.existsSync(packageLockJsonPath);
}

export function readPackageLock(): PackageLock {
  try {
    // Check if package-lock.json exists
    if (!fs.existsSync(packageLockJsonPath)) {
      throw new Error(`Package lock file not found at ${packageLockJsonPath}`);
    }
    
    // Read the file content
    const fileContent = fs.readFileSync(packageLockJsonPath, 'utf8');
    
    // Parse the JSON content
    const parsedContent = JSON.parse(fileContent) as PackageLock;
    
    // Validate the essential structure
    if (!parsedContent.name || !parsedContent.version || !parsedContent.packages) {
      throw new Error('Invalid package-lock.json format: missing required fields');
    }
    
    // Ensure lockfileVersion is present (current standard is 3)
    if (typeof parsedContent.lockfileVersion !== 'number') {
      throw new Error('Invalid package-lock.json format: missing or invalid lockfileVersion');
    }
    
    console.log(`Successfully read package-lock.json from ${packageLockJsonPath}`);
    return parsedContent;
    
  } catch (error) {
    console.error('Failed to read package-lock.json:', error);
    throw error;
  }
}