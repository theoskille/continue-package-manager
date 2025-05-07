import { InstallationPlan, DependencyInstallation } from "../../types";
import { getPackageMetadata } from "../../util/registry";
import semver from "semver";
import crypto from 'crypto';
import https from 'https';
import { writePackageLock, packageLockExists, readPackageLock } from "../../util/paths";

// package-lock.json structure
export interface PackageLock {
  name: string;                  // Project name
  version: string;               // Project version
  lockfileVersion: number;       // Lock file format version (current is 3)
  requires: boolean;             // Whether requires are enforced
  packages: Record<string, PackageLockEntry>; // Map of package information
}

export interface PackageLockEntry {
  name?: string;                 // Optional name
  version: string;               // Exact version
  resolved?: string;              // Registry URL
  integrity?: string;             // Content hash (SHA-512)
  dependencies?: Record<string, string>; // Direct dependencies
  requires?: Record<string, string>;     // Required dependencies
  dev?: boolean;                 // If it's a dev dependency
}

export interface PackageMetadata {
  versions: Record<string, {
    dependencies: Record<string, string>;
  }>;
}

interface PackageNode {
  name: string;
  versionRequirements: Set<string>;
  dependencies: Map<string, Set<string>>; // dependency name -> Set of version ranges
}

/**
 *
 * @param topLevelDependencies The list of dependencies as determined by package.json's `dependencies` object
 * @returns The installation plan
 */
export async function constructInstallationPlan(
  topLevelDependencies: Record<string, string>
): Promise<InstallationPlan> {
  // check if package-lock.json exists. if it does, build using lock file
  if(packageLockExists()) {
    const packageLock: PackageLock = readPackageLock();
    return buildInstallationPlanFromLock(packageLock, topLevelDependencies);
  }

  // Cache for package metadata to avoid duplicate network calls
  const metadataCache = new Map<string, PackageMetadata>();
  
  // Package graph for all dependencies
  const packageGraph = new Map<string, PackageNode>();
  
  // Final installation plan
  const installationPlan: InstallationPlan = [];
  
  // Fetch metadata and build the complete package graph
  async function buildDependencyGraph(
    name: string,
    versionRange: string,
    parentPackage?: string
  ): Promise<void> {
    console.log(`Building graph node for ${name}@${versionRange}`);
    // Create or update package node
    if (!packageGraph.has(name)) {
      packageGraph.set(name, {
        name,
        versionRequirements: new Set(),
        dependencies: new Map()
      });
    }
    
    const packageNode = packageGraph.get(name)!;
    packageNode.versionRequirements.add(versionRange);
    
    // Fetch metadata (from cache if possible)
    if (!metadataCache.has(name)) {
      const metadata = await getPackageMetadata(name);

      // Only store the versions information we need
      metadataCache.set(name, {
        versions: metadata.versions || {}
      });
    }
    
    const metadata = metadataCache.get(name)!;
    const availableVersions = Object.keys(metadata.versions || {});
    
    // Resolve version
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
    
    // Add dependencies to this package node
    for (const [depName, depVersionRange] of Object.entries(dependencies)) {
      if (!packageNode.dependencies.has(depName)) {
        packageNode.dependencies.set(depName, new Set());
      }
      packageNode.dependencies.get(depName)!.add(depVersionRange as string);
      
      // Process each dependency
      await buildDependencyGraph(depName, depVersionRange as string, name);
    }
  }
  
  // Determine optimal version for each package
  function findOptimalVersion(name: string): string {
    const packageNode = packageGraph.get(name)!;
    const metadata = metadataCache.get(name)!;
    const availableVersions = Object.keys(metadata.versions || {});
    
    // For each available version, count how many ranges it satisfies
    const versionSatisfactionCount = new Map<string, number>();
    
    for (const version of availableVersions) {
      let satisfiedCount = 0;
      
      for (const range of packageNode.versionRequirements) {
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
    
    return bestVersion;
  }
  
  // Build installation plan
  async function buildInstallationPlan(optimalVersions: Map<string, string>): Promise<InstallationPlan> {
    const rootPackages = new Map<string, string>();
    const plan: InstallationPlan = [];
    
    
    // Process function to create installation plan
    function processDependency(
      name: string,
      versionRange: string,
      parentPath?: string
    ): void {
      const optimalVersion = optimalVersions.get(name)!;
      const satisfiesRange = semver.satisfies(optimalVersion, versionRange);
      
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
          plan.push({ name, version });
        } else {
          // Conflict, install nested
          plan.push({
            name,
            version,
            parentDirectory: parentPath
          });
        }
        
        // Process dependencies
        const packageNode = packageGraph.get(name)!;
        for (const [depName, depVersionRanges] of packageNode.dependencies.entries()) {
          // Just pick the first version range for simplicity
          // In a more advanced implementation, you might want to be smarter here
          const depVersionRange = [...depVersionRanges][0];
          
          const newParentPath = isConflict || parentPath 
            ? `${parentPath || ''}${parentPath ? '/' : ''}${name}/node_modules` 
            : `${name}/node_modules`;
            
          processDependency(depName, depVersionRange, newParentPath);
        }
      } else {
        // Optimal version doesn't satisfy this range, need to use specific version
        const metadata = metadataCache.get(name)!;
        const availableVersions = Object.keys(metadata.versions || {});
        
        // Resolve to best version for this specific range
        const version = semver.maxSatisfying(availableVersions, versionRange);
        
        if (!version) {
          throw new Error(`Cannot resolve ${name}@${versionRange}`);
        }
        
        // Always install nested since this is a specific version requirement
        plan.push({
          name,
          version,
          parentDirectory: parentPath
        });
        
        // Process dependencies
        const packageJson = metadata.versions[version];
        const dependencies = packageJson.dependencies || {};
        
        for (const [depName, depVersionRange] of Object.entries(dependencies)) {
          const newParentPath = `${parentPath || ''}${parentPath ? '/' : ''}${name}/node_modules`;
          processDependency(depName, depVersionRange as string, newParentPath);
        }
      }
    }
    
    // Start with top-level dependencies
    for (const [name, versionRange] of Object.entries(topLevelDependencies)) {
      processDependency(name, versionRange);
    }
    
    return plan;
  }
  
  // Main execution flow
  try {
    // Build complete dependency graph (with single traversal)
    for (const [name, versionRange] of Object.entries(topLevelDependencies)) {
      await buildDependencyGraph(name, versionRange);
    }
    
    // Calculate optimal versions
    const optimalVersions = new Map<string, string>();
    for (const [name, packageNode] of packageGraph.entries()) {
      optimalVersions.set(name, findOptimalVersion(name));
    }
    
    const plan = await buildInstallationPlan(optimalVersions);
    console.log(visualizeInstallationTree(plan));

    // generate package-lock.json
    const packageLock: PackageLock = await generatePackageLock("my-project", "1.0.0",  plan, metadataCache, topLevelDependencies);
    console.log(packageLock);
    writePackageLock(packageLock);

    return plan;
  } catch (error) {
    console.error("Error constructing installation plan:", error);
    throw error;
  }
}

function visualizeInstallationTree(installationPlan: InstallationPlan): string {
  let output = "Installation Tree Structure\n";
  output += "==========================\n\n";
  output += "node_modules/\n";
  
  // Track packages installed at root
  const rootPackages = installationPlan
    .filter(item => !item.parentDirectory)
    .sort((a, b) => a.name.localeCompare(b.name));
  
  // Organize nested packages by their parent directories
  const nestedPackages = new Map<string, DependencyInstallation[]>();
  
  for (const item of installationPlan) {
    if (item.parentDirectory) {
      if (!nestedPackages.has(item.parentDirectory)) {
        nestedPackages.set(item.parentDirectory, []);
      }
      nestedPackages.get(item.parentDirectory)!.push(item);
    }
  }
  
  // Function to recursively print the tree structure
  function printTree(
    packages: DependencyInstallation[],
    basePath: string = "",
    indent: string = "│   "
  ): string {
    let result = "";
    
    // Sort packages alphabetically for consistent output
    const sortedPackages = [...packages].sort((a, b) => a.name.localeCompare(b.name));
    
    for (let i = 0; i < sortedPackages.length; i++) {
      const pkg = sortedPackages[i];
      const isLast = i === sortedPackages.length - 1;
      const prefix = isLast ? "└── " : "├── ";
      
      // Print this package
      result += `${indent}${prefix}${pkg.name}@${pkg.version}\n`;
      
      // Calculate the next level path for this package
      const nextPath = basePath ? 
        `${basePath}/${pkg.name}/node_modules` : 
        `${pkg.name}/node_modules`;
      
      // Check if this package has nested dependencies
      if (nestedPackages.has(nextPath)) {
        const nextIndent = indent + (isLast ? "    " : "│   ");
        
        // Add node_modules folder
        result += `${indent}${isLast ? "    " : "│   "}└── node_modules\n`;
        
        // Print nested packages
        result += printTree(
          nestedPackages.get(nextPath)!,
          nextPath,
          nextIndent + "    "
        );
      }
    }
    
    return result;
  }
  
  // Print root level packages
  output += printTree(rootPackages, "", "");
  
  // Add some statistics
  const rootCount = rootPackages.length;
  const nestedCount = installationPlan.length - rootCount;
  const maxNestingLevel = Math.max(
    0,
    ...Array.from(nestedPackages.keys())
      .map(path => path.split('/').filter(p => p === 'node_modules').length)
  );
  
  output += "\nInstallation Statistics:\n";
  output += `Total packages: ${installationPlan.length}\n`;
  output += `Root packages: ${rootCount}\n`;
  output += `Nested packages: ${nestedCount}\n`;
  output += `Maximum nesting depth: ${maxNestingLevel}\n`;
  output += `Flattening efficiency: ${Math.round((rootCount / installationPlan.length) * 100)}%\n`;
  
  return output;
}

async function generatePackageLock(
  projectName: string,
  projectVersion: string,
  installationPlan: InstallationPlan,
  metadataCache: Map<string, PackageMetadata>,
  topLevelDependencies: Record<string, string>
): Promise<PackageLock> {
  const packageLock: PackageLock = {
    name: projectName,
    version: projectVersion,
    lockfileVersion: 3,
    requires: true,
    packages: {}
  };

  const resolvedTopLevelDependencies: Record<string, string> = {};
  
  // Find the resolved versions from the installation plan
  // Only consider packages installed at the root level (no parentDirectory)
  for (const pkg of installationPlan) {
    if (!pkg.parentDirectory && topLevelDependencies.hasOwnProperty(pkg.name)) {
      resolvedTopLevelDependencies[pkg.name] = pkg.version;
    }
  }
  
  // Add root entry
  packageLock.packages[""] = {
    name: projectName,
    version: projectVersion,
    dependencies: resolvedTopLevelDependencies // Fill with top-level dependencies
  };
  
  // Process each package in the installation plan
  for (const pkg of installationPlan) {
    const path = pkg.parentDirectory 
      ? `node_modules/${pkg.parentDirectory}/${pkg.name}`
      : `node_modules/${pkg.name}`;
    
    // Get package metadata for integrity, resolved URL, etc.
    const metadata = metadataCache.get(pkg.name)!;
    const versionMetadata = metadata.versions[pkg.version];
    
    // Add package entry
    packageLock.packages[path] = {
      version: pkg.version,
      resolved: `https://registry.npmjs.org/${pkg.name}/-/${pkg.name}-${pkg.version}.tgz`,
      integrity: await calculateIntegrity(pkg.name, pkg.version), // You'll need to implement this
      dependencies: versionMetadata.dependencies || {},
      // Add any other required fields
    };
  }
  
  return packageLock;
}

/**
 * Calculates the integrity hash for a package
 * @param name Package name
 * @param version Package version
 * @returns Integrity string in SRI format (e.g., "sha512-base64Hash")
 */
async function calculateIntegrity(name: string, version: string): Promise<string> {
  // Construct the tarball URL (following npm's convention)
  const tarballUrl = `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
  
  try {
    // Fetch the package tarball
    const tarballBuffer = await fetchTarball(tarballUrl);
    
    // Calculate SHA-512 hash
    const hash = crypto.createHash('sha512');
    hash.update(tarballBuffer);
    const integrity = hash.digest('base64');
    
    // Return in SRI format
    return `sha512-${integrity}`;
  } catch (error) {
    console.error(`Failed to calculate integrity for ${name}@${version}:`, error);
    throw error;
  }
}

/**
 * Fetches a tarball from a URL
 * @param url URL of the tarball
 * @returns Buffer containing the tarball data
 */
function fetchTarball(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    
    https.get(url, (response) => {
      // Handle redirects (common with npm registry)
      if (response.statusCode === 302 || response.statusCode === 301) {
        const redirectUrl = response.headers.location;
        if (!redirectUrl) {
          return reject(new Error('Redirect without location header'));
        }
        
        // Follow the redirect
        return resolve(fetchTarball(redirectUrl));
      }
      
      // Check for successful response
      if (response.statusCode !== 200) {
        return reject(
          new Error(`Failed to download tarball: ${response.statusCode}`)
        );
      }
      
      // Collect data chunks
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      
      // Concatenate chunks when download completes
      response.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      
      response.on('error', (err) => {
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

function buildInstallationPlanFromLock(
  packageLock: PackageLock,
  topLevelDependencies: Record<string, string>
): InstallationPlan {
  const plan: InstallationPlan = [];
  
  // Check if the top-level dependencies match what's in package.json
  // If not, we might need to resolve from scratch
  let lockfileIsValid = true;
  
  // Get the root package info
  const rootPackage = packageLock.packages[""];
  
  if (!rootPackage || !rootPackage.dependencies) {
    console.warn('Invalid package-lock.json: missing root package information');
    return []; // Return empty plan to trigger resolution from scratch
  }
  
  // Validate that all top-level dependencies are in the lock file
  for (const [name, versionRange] of Object.entries(topLevelDependencies)) {
    if (!rootPackage.dependencies[name]) {
      console.warn(`Package ${name} is in package.json but not in package-lock.json`);
      lockfileIsValid = false;
      break;
    }
    
    // Optionally: Check if the locked version satisfies the range
    // This would require importing semver again
    // if (!semver.satisfies(rootPackage.dependencies[name], versionRange)) {
    //   console.warn(`Locked version ${rootPackage.dependencies[name]} for ${name} doesn't satisfy range ${versionRange}`);
    //   lockfileIsValid = false;
    //   break;
    // }
  }
  
  if (!lockfileIsValid) {
    console.warn('Lock file is invalid or outdated, will resolve dependencies from scratch');
    return []; // Return empty plan to trigger resolution from scratch
  }
  
  // Process each package in the lock file
  for (const [path, packageInfo] of Object.entries(packageLock.packages)) {
    if (path === "") continue; // Skip the root entry
    
    // Parse the path to determine parent directory and package name
    // e.g., "node_modules/express" -> { name: "express", parentDirectory: undefined }
    // e.g., "node_modules/express/node_modules/body-parser" -> { name: "body-parser", parentDirectory: "express/node_modules" }
    
    let parentDirectory: string | undefined = undefined;
    let name: string;
    
    if (path.includes('/')) {
      const parts = path.split('/');
      name = parts[parts.length - 1];
      
      if (parts.length > 2) {
        // This is a nested dependency
        // Remove the first "node_modules/" and the last package name
        parentDirectory = parts.slice(1, -1).join('/');
      }
    } else {
      // This is a top-level package in node_modules
      name = path;
    }
    
    // Add to installation plan
    plan.push({
      name,
      version: packageInfo.version,
      parentDirectory
    });
  }
  
  return plan;
}