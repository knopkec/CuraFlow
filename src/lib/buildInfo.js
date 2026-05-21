function normalizeBuildInfo(buildInfo) {
  if (!buildInfo || typeof buildInfo !== 'object') {
    return { commitSha: '', commitShortSha: '' };
  }

  const commitSha = typeof buildInfo.commitSha === 'string' ? buildInfo.commitSha.trim() : '';
  const explicitShortSha = typeof buildInfo.commitShortSha === 'string' ? buildInfo.commitShortSha.trim() : '';
  const commitShortSha = explicitShortSha || (commitSha ? commitSha.slice(0, 7) : '');

  return { commitSha, commitShortSha };
}

export function getBuildInfo() {
  return normalizeBuildInfo(globalThis.__CURAFLOW_BUILD_INFO__);
}

