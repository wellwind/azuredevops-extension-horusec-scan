import tl = require('azure-pipelines-task-lib/task');
import child_process = require('child_process');
import fs = require('fs');

// TODO: change script to horusec

async function run() {
  try {
    // get inputs
    const projectPath = tl.getInput('projectPath', true);
    const sarifReportPath = tl.getInput('sarifReportPath', false);
    const otherOptions = tl.getInput('otherOptions', false);

    const agentOS = tl.getVariable('Agent.OS');
    const agentTempDirectory = tl.getVariable('Agent.ToolsDirectory');
    const horusecInstallationPath = `${agentTempDirectory}/horusec`;

    // install security-scan dotnet tool
    if (agentOS === 'Windows_NT') {
      fs.mkdirSync(horusecInstallationPath);
      const installResult = child_process
        .execSync(
          `curl -k "https://github.com/ZupIT/horusec/releases/latest/download/horusec_win_amd64.exe" -o "${horusecInstallationPath}/horusec.exe" -L`
        )
        .toString('utf-8');
      console.log(`##vso[task.debug] ${installResult}`);
    } else {
      const installResult = child_process
        .execSync(
          `curl -fsSL https://raw.githubusercontent.com/ZupIT/horusec/main/deployments/scripts/install.sh | bash -s latest`
        )
        .toString('utf-8');
      console.log(`##vso[task.debug] ${installResult}`);
    }

    // build scan command
    let command = '';
    if (agentOS === 'Windows_NT') {
      command = `${horusecInstallationPath}/horusec.exe start`;
    } else {
      command = `horusec start`;
    }

    command += ` -p ${projectPath}`;

    if (sarifReportPath && sarifReportPath.length > 0) {
      command += ` -o sarif -O "${sarifReportPath}"`;
    }
    if (otherOptions && otherOptions.length > 0) {
      command += ` ${otherOptions}`;
    }

    console.log(`##vso[task.debug]command=${command}`);

    // run scan command
    const scanResult = child_process.execSync(command).toString('utf-8');
    console.log(`##vso[task.debug] ${scanResult}`);
  } catch (err: any) {
    tl.setResult(tl.TaskResult.Failed, err.message);
  } finally {
    try {
      const sarifReportPath = tl.getInput('sarifReportPath', false);
      const sarifPathConvert = tl.getBoolInput('sarifPathConvert', false);

      if (sarifPathConvert && sarifReportPath && sarifReportPath.length > 0) {
        const content = fs.readFileSync(sarifReportPath).toString('utf-8');
        const sourceVersion = tl.getVariable('Build.SourceVersion') || '';
        // get base repository uri
        const repositoryUri = tl.getVariable('Build.Repository.Uri') || '';
        const chunks = repositoryUri!.replace('https://', '').split('@');
        let baseUri = chunks[0];
        if (chunks?.length > 1) {
          baseUri = chunks[1];
        }

        const generateUri = (location: any) => {
          const path = location.physicalLocation.artifactLocation.uri;
          let uri = `https://${baseUri}?path=${path}&version=GC${sourceVersion}`;
          if (location.physicalLocation.region.startLine) {
            uri += `&line=${location.physicalLocation.region.startLine}`;
          }
          if (location.physicalLocation.region.endLine) {
            uri += `&lineEnd=${location.physicalLocation.region.endLine}`;
          }
          if (location.physicalLocation.region.startColumn) {
            uri += `&lineStartColumn=${location.physicalLocation.region.startColumn}`;
          }
          if (location.physicalLocation.region.endColumn) {
            uri += `&lineEndColumn=${location.physicalLocation.region.endColumn}`;
          }
          return uri;
        };

        const obj = JSON.parse(content) as any;
        for (const run of obj.runs || []) {
          for (const result of run.results || []) {
            // locations
            for (const location of result.locations || []) {
              location.physicalLocation.artifactLocation.uri =
                generateUri(location);
            }
            // relatedLocations
            for (const location of result.relatedLocations || []) {
              location.physicalLocation.artifactLocation.uri =
                generateUri(location);
            }
          }
        }

        const scanContent = JSON.stringify(obj);
        console.log(`##vso[task.debug] ${scanContent}`);
        fs.writeFileSync(sarifReportPath, scanContent);
      }
    } catch (err: any) {
      tl.setResult(tl.TaskResult.Failed, err.message);
    }
  }
}

run();
