import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";
import * as fs from "fs";


/**
 * .versionファイルのバージョンを更新する関数
 * 
 * @param filePath - 更新する.versionファイルのパス
 * @param version - 更新するバージョン
 */
export function updateVersionFile(filePath: string, version: string) {
  // .versionファイルの内容を更新
  fs.writeFileSync(filePath, version, "utf-8");
  core.info(`Updated version file: ${filePath} to version ${version}`);
}
/**
 * build.gradleファイルのバージョンを更新する関数
 * 
 * @param filePath - 更新するbuild.gradleファイルのパス
 * @param version - 更新するバージョン
 */
export function updateGradleVersion(filePath: string, version: string) {
  //  version = '(文字列)'のような行を置き換える
  // 例: version = '1.0.0' -> version = '2.0.0'
  // 例: version =  '1.0.0-SNAPSHOT' -> version = '2.0.0'
  const regex = /version\s*=\s*['"]?(\d+\.\d+\.\d+(-SNAPSHOT)?)['"]?/;

  const content
    = fs.readFileSync(filePath, "utf-8");
  const newContent = content.replace(regex, `version = '${version}'`);
  fs.writeFileSync(filePath, newContent, "utf-8");
  core.info(`Updated gradle file: ${filePath} to version ${version}`);
}

/**
 * package.jsonファイルのバージョンを更新する関数
 * 
 * @param filePath - 更新するpackage.jsonファイルのパス
 * @param version - 更新するバージョン
 */
export function updatePackageJsonVersion(filePath: string, version: string) {
  /// "version": "1.0.0"のような行を置き換える
  const regex = /"version":\s*["']?(\d+\.\d+\.\d+)["']?/;
  const content
    = fs.readFileSync(filePath, "utf-8");
  const newContent = content.replace(regex, `"version": "${version}"`);
  fs.writeFileSync(filePath, newContent, "utf-8");
  core.info(`Updated package.json file: ${filePath} to version ${version}`);
}

/**
 * リリース用のPull Requestを作成する Github Actions
 */
async function run() {
  try {

    // == 入力値の取得 ==
    const {
      github_token,
      dot_version_file_path,
      build_gradle_file_paths,
      package_json_file_paths,
      release_version,
      release_type,
      labels,
      assignees,
      reviewers,
    } = {
      github_token: core.getInput("github_token", { required: true }),
      dot_version_file_path: core.getInput("dot_version_file_path", { required: false }) || ".version",
      build_gradle_file_paths: core.getMultilineInput("build_gradle_file_paths", { required: false }),
      package_json_file_paths: core.getMultilineInput("package_json_file_paths", { required: false }),
      release_version: core.getInput("release_version", { required: false }),
      release_type: core.getInput("release_type", { required: false }) || "patch",
      labels: core.getInput("labels", { required: false }),
      assignees: core.getInput("assignees", { required: false }),
      reviewers: core.getInput("reviewers", { required: false }),
    }

    // == バージョンを決める ==
    // バージョン
    let version: string;
    if (release_version) {
      // 明示的なバージョン指定があればそれを使用
      core.info(`Release version specified: ${release_version}`);
      // 1.0.0のような形式であることを確認
      const versionRegex = /^\d+\.\d+\.\d+$/;
      if (!versionRegex.test(release_version)) {
        core.setFailed(`Invalid version format: ${release_version}`);
        return;
      }
      version = release_version;
    } else {
      // 明示的なバージョン指定がなければ、.versionファイルからバージョンを取得、ただしrelease_typeを指定する必要がある
      if (!release_type) {
        core.setFailed(`release_type is required when release_version is not specified`);
        return;
      }
      core.info(`Release type specified: ${release_type}`);
      // .versionファイルから現在のバージョンを取得(無ければエラー)
      const versionFilePath = dot_version_file_path;
      if (!fs.existsSync(versionFilePath)) {
        core.setFailed(`Version file not found: ${versionFilePath}`);
        return;
      }
      const versionFileContent = fs.readFileSync(versionFilePath, "utf-8");

      // タグとリリースタイプから新しいバージョンを決定
      const versionParts = versionFileContent.trim().split(".");
      let major = parseInt(versionParts[0]);
      let minor = parseInt(versionParts[1]);
      let patch = parseInt(versionParts[2]);
      switch (release_type) {
        case "major":
          major++;
          minor = 0;
          patch = 0;
          break;
        case "minor":
          minor++;
          patch = 0;
          break;
        case "patch":
          patch++;
          break;
        default:
          core.setFailed(`Invalid release type: ${release_type}`);
          return;
      }

      // 新しいバージョンを生成(vは付けない)
      const release_version = `${major}.${minor}.${patch}`;
      core.info(`New release version: ${release_version}`);
      version = release_version;
    }

    core.info(`Using specified version: ${version}`);

    // === バージョンを更新 ===
    // リリース用のブランチへcheckout
    const branchName = `release/${version}`;
    await exec.exec("git", ["config", "--global", "user.name", "github-actions"]);
    await exec.exec("git", ["config", "--global", "user.email", "github-actions@users.noreply.github.com"]);
    await exec.exec("git", ["remote", "set-url", "origin", `https://github-actions:${github_token}@github.com/${github.context.repo.owner}/${github.context.repo.repo}`]);
    await exec.exec("git", ["checkout", "-b", branchName]);

    // .versionファイルのバージョンを更新
    if (dot_version_file_path) {
      core.info(`Updating version in ${dot_version_file_path}`);
      updateVersionFile(dot_version_file_path, version);
      await exec.exec("git", ["add", dot_version_file_path]);
    }
    // build.gradleファイルのバージョンを更新
    if (build_gradle_file_paths && build_gradle_file_paths.length > 0) {
      for (const filePath of build_gradle_file_paths) {
        core.info(`Updating version in ${filePath}`);
        updateGradleVersion(filePath, version);
        await exec.exec("git", ["add", filePath]);
      }
    }

    // package.jsonファイルのバージョンを更新
    if (package_json_file_paths && package_json_file_paths.length > 0) {
      for (const filePath of package_json_file_paths) {
        core.info(`Updating version in ${filePath}`);
        updatePackageJsonVersion(filePath, version);
        await exec.exec("git", ["add", filePath]);
      }
    }

    // 変更を全てコミット
    await exec.exec("git", ["commit", "-m", `Release ${version}`]);
    await exec.exec("git", ["push", "origin", branchName]);
    core.info(`Pushed branch ${branchName} to origin`);


    // Pull Requestを作成
    const octokit = github.getOctokit(github_token);
    const { data: pullRequest } = await octokit.rest.pulls.create({
      ...github.context.repo,
      title: `Release ${version}`,
      head: branchName,
      base: "main",
      body: `Release ${version}`,
    });
    core.info(`Created pull request: ${pullRequest.html_url}`);
    core.setOutput("pull_request_url", pullRequest.html_url);
    core.setOutput("pull_request_number", pullRequest.number.toString());

    const prNumber = pullRequest.number;

    // ラベルを追加
    if (labels) {
      const labelList = labels.split(",").map(l => l.trim()).filter(l => l);
      if (labelList.length > 0) {
        await octokit.rest.issues.addLabels({
          ...github.context.repo,
          issue_number: prNumber,
          labels: labelList,
        });
        core.info(`Added labels: ${labelList.join(", ")}`);
      }
    }

    // アサインを追加
    if (assignees) {
      const assigneeList = assignees.split(",").map(a => a.trim()).filter(a => a);
      if (assigneeList.length > 0) {
        await octokit.rest.issues.addAssignees({
          ...github.context.repo,
          issue_number: prNumber,
          assignees: assigneeList,
        });
        core.info(`Added assignees: ${assigneeList.join(", ")}`);
      }
    }

    // レビュアーを追加
    if (reviewers) {
      const reviewerList = reviewers.split(",").map(r => r.trim()).filter(r => r);
      if (reviewerList.length > 0) {
        await octokit.rest.pulls.requestReviewers({
          ...github.context.repo,
          pull_number: prNumber,
          reviewers: reviewerList,
        });
        core.info(`Added reviewers: ${reviewerList.join(", ")}`);
      }
    }
  } catch (error: any) {
    core.error(`Error reading version file: ${error.message}`);
    core.setFailed(error.message);
  }

}

run();


/**
 * 動作確認用
 */
async function test() {
  // .versionファイルのバージョンを更新
  updateVersionFile(".version", "1.0.0");
  // build.gradleファイルのバージョンを更新
  updateGradleVersion("samples/build.gradle", "1.0.0");
  // package.jsonファイルのバージョンを更新
  updatePackageJsonVersion("samples/package.json", "1.0.0");
}

// test();