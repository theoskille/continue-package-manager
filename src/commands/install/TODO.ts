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

  // Track all version requirements for each package
  const versionRequirements = new Map<string, Set<string>>(); // package name -> Set of version ranges

  // Track the optimal version for each package
  const optimalVersions = new Map<string, string>();
  
  // Track what's already installed at root
  const rootPackages = new Map<string, string>(); // name -> version


  async function collectRequirements(
    name: string,
    versionRange: string
  ): Promise<void> {
    if (!versionRequirements.has(name)) {
      versionRequirements.set(name, new Set<string>());
    }
    versionRequirements.get(name)!.add(versionRange);
    
    // Get metadata to resolve version
    const metadata = await getPackageMetadata(name);
    const availableVersions = Object.keys(metadata.versions || {});
    
    // Resolve to exact version
    const resolvedVersion = semver.maxSatisfying(availableVersions, versionRange);
    
    if (!resolvedVersion) {
      throw new Error(`Cannot resolve ${name}@${versionRange}`);
    }
    
    // Get dependencies for this version
    const packageJson = metadata.versions[resolvedVersion];
    if (!packageJson) {
      throw new Error(`Version data for ${name}@${resolvedVersion} not found`);
    }
    
    const dependencies = packageJson.dependencies || {};
    
    // Collect requirements for each dependency
    for (const [depName, depVersionRange] of Object.entries(dependencies)) {
      await collectRequirements(depName, depVersionRange as string);
    }
  }
  
  async function findOptimalVersion(
    name: string, 
    ranges: Set<string>
  ): Promise<string> {
    const metadata = await getPackageMetadata(name);
    const availableVersions = Object.keys(metadata.versions || {});
    
    // For each available version, count how many ranges it satisfies
    const versionSatisfactionCount = new Map<string, number>();
    
    for (const version of availableVersions) {
      let satisfiedCount = 0;
      
      for (const range of ranges) {
        if (semver.satisfies(version, range)) {
          satisfiedCount++;
        }
      }
      
      versionSatisfactionCount.set(version, satisfiedCount);
    }
    
    // Find version that satisfies most ranges (prefer higher versions if tied)
    let bestVersion = '';
    let maxSatisfied = 0;
    
    for (const [version, count] of versionSatisfactionCount.entries()) {
      if (count > maxSatisfied || 
          (count === maxSatisfied && bestVersion && semver.gt(version, bestVersion))) {
        maxSatisfied = count;
        bestVersion = version;
      }
    }
    
    if (!bestVersion) {
      throw new Error(`Could not find optimal version for ${name}`);
    }
    
    // Log if we couldn't satisfy all ranges
    const totalRanges = ranges.size;
    if (maxSatisfied < totalRanges) {
      console.log(`Warning: ${name} - Best version ${bestVersion} satisfies ${maxSatisfied}/${totalRanges} requirements`);
    }
    
    return bestVersion;
  }

  async function processDependency(
    name: string,
    versionRange: string,
    parentPath?: string
  ): Promise<void> {
    // Get the optimal version for this package
    const optimalVersion = optimalVersions.get(name)!;
    
    // Check if the optimal version satisfies this particular range
    const satisfiesRange = semver.satisfies(optimalVersion, versionRange);
    
    // If our optimal version works for this range, try to use it
    if (satisfiesRange) {
      const version = optimalVersion;
      
      // Already installed at root with same version? Skip
      if (rootPackages.has(name) && rootPackages.get(name) === version) {
        return;
      }
      
      // Check if we have a conflict at root
      const isConflict = rootPackages.has(name) && rootPackages.get(name) !== version;
      
      if (!isConflict) {
        // Can install at root
        rootPackages.set(name, version);
        installationPlan.push({ name, version });
      } else {
        // Conflict, install nested
        installationPlan.push({
          name,
          version,
          parentDirectory: parentPath
        });
      }
      
      // Process dependencies
      try {
        const metadata = await getPackageMetadata(name);
        const packageJson = metadata.versions[version];
        
        if (!packageJson) {
          throw new Error(`Version ${version} not found for ${name}`);
        }
        
        const dependencies = packageJson.dependencies || {};
        
        for (const [depName, depVersionRange] of Object.entries(dependencies)) {
          const newParentPath = isConflict || parentPath 
            ? `${parentPath || ''}${parentPath ? '/' : ''}${name}/node_modules` 
            : `${name}/node_modules`;
            
          await processDependency(depName, depVersionRange as string, newParentPath);
        }
      } catch (error) {
        console.error(`Error processing ${name}@${version}:`, error);
      }
    } else {
      // Optimal version doesn't satisfy this range, need to use specific version
      const metadata = await getPackageMetadata(name);
      const availableVersions = Object.keys(metadata.versions || {});
      
      // Resolve to best version for this specific range
      const version = semver.maxSatisfying(availableVersions, versionRange);
      
      if (!version) {
        throw new Error(`Cannot resolve ${name}@${versionRange}`);
      }
      
      // Always install nested since this is a specific version requirement
      installationPlan.push({
        name,
        version,
        parentDirectory: parentPath
      });
      
      // Process dependencies
      try {
        const packageJson = metadata.versions[version];
        
        if (!packageJson) {
          throw new Error(`Version ${version} not found for ${name}`);
        }
        
        const dependencies = packageJson.dependencies || {};
        
        for (const [depName, depVersionRange] of Object.entries(dependencies)) {
          const newParentPath = `${parentPath || ''}${parentPath ? '/' : ''}${name}/node_modules`;
          await processDependency(depName, depVersionRange as string, newParentPath);
        }
      } catch (error) {
        console.error(`Error processing ${name}@${version}:`, error);
      }
    }
  }
  
  // Main execution flow
  try {
    // Collect all version requirements
    for (const [name, versionRange] of Object.entries(topLevelDependencies)) {
      await collectRequirements(name, versionRange);
    }
    
    // Find optimal version for each package
    for (const [name, ranges] of versionRequirements.entries()) {
      const bestVersion = await findOptimalVersion(name, ranges);
      optimalVersions.set(name, bestVersion);
    }
    
    // Build installation plan using optimal versions
    for (const [name, versionRange] of Object.entries(topLevelDependencies)) {
      await processDependency(name, versionRange);
    }
    
    return installationPlan;
  } catch (error) {
    console.error("Error constructing installation plan:", error);
    throw error;
  }
}

// async function resolveVersion(name: string, versionRange: string): Promise<string> {
//   // Get metadata for the package
//   const metadata = await getPackageMetadata(name);
  
//   // Extract all available versions
//   const availableVersions = Object.keys(metadata.versions || {});
  
//   // Find the highest version that satisfies the range
//   const resolvedVersion = semver.maxSatisfying(availableVersions, versionRange);
  
//   if (!resolvedVersion) {
//     throw new Error(`Cannot resolve version range ${versionRange} for package ${name}`);
//   }
  
//   return resolvedVersion;
// }