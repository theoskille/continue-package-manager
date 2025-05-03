import { InstallationPlan, DependencyInstallation } from "../../types";
import { getPackageMetadata } from "../../util/registry";
import semver from "semver";

/**
 *
 * @param topLevelDependencies The list of dependencies as determined by package.json's `dependencies` object
 * @returns The installation plan
 */
export async function constructInstallationPlan(
  topLevelDependencies: Record<string, string>
): Promise<InstallationPlan> {
  const installationPlan: InstallationPlan = [];
  
  const rootPackages = new Map<string, string>(); // name -> version
  
  async function processDependency(
    name: string,
    versionRange: string,
    parentPath?: string
  ): Promise<void> {
    const version = await resolveVersion(name, versionRange);

    if (rootPackages.has(name) && rootPackages.get(name) === version)
      return;
    
    // Check if we have a different version at root (conflict)
    const isConflict = rootPackages.has(name) && rootPackages.get(name) !== version;
    
    // Decide where to install
    if (!isConflict && !parentPath) {
      // Top-level dependency, install at root
      console.log("top level", name);
      rootPackages.set(name, version);
      installationPlan.push({ name, version });
    } else if (!isConflict && parentPath) {
      // Transitive dependency, no conflict, install at root
      console.log("transitive", name);
      rootPackages.set(name, version);
      installationPlan.push({ name, version });
    } else {
      // Conflict, install under parent
      console.log("conflict", name);
      installationPlan.push({
        name,
        version,
        parentDirectory: parentPath
      });
    }
    
    // get subdependencies
    try {
      const metadata = await getPackageMetadata(name);
      
      const packageJson = metadata.versions[version];
      if (!packageJson) {
        throw new Error(`Version ${version} not found for ${name}`);
      }
      
      const dependencies = packageJson.dependencies || {};
      
      // Process each sub-dependency
      for (const [depName, depVersionRange] of Object.entries(dependencies)) {
        const newParentPath = isConflict || parentPath 
          ? `${parentPath || ''}${parentPath ? '/' : ''}${name}/node_modules` 
          : `${name}/node_modules`;
          
        await processDependency(depName, depVersionRange as string, newParentPath);
      }
    } catch (error) {
      console.error(`Error processing ${name}@${version}:`, error);
    }
  }
  
  // Start processing each top-level dependency
  for (const [name, versionRange] of Object.entries(topLevelDependencies)) {
    await processDependency(name, versionRange);
  }
  
  return installationPlan;
}

async function resolveVersion(name: string, versionRange: string): Promise<string> {
  // Get metadata for the package
  const metadata = await getPackageMetadata(name);
  
  // Extract all available versions
  const availableVersions = Object.keys(metadata.versions || {});
  
  // Find the highest version that satisfies the range
  const resolvedVersion = semver.maxSatisfying(availableVersions, versionRange);
  
  if (!resolvedVersion) {
    throw new Error(`Cannot resolve version range ${versionRange} for package ${name}`);
  }
  
  return resolvedVersion;
}