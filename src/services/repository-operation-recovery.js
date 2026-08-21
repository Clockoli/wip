function isRepositoryNotFound(error) {
  return error?.status === 404 || error?.code === 'not_found';
}

export async function withRepositoryRecovery(operation, { shouldRecover, recover }) {
  try {
    return await operation();
  } catch (error) {
    if (!isRepositoryNotFound(error) || !await shouldRecover(error)) throw error;
    if (await recover(error) === false) throw error;
    return operation();
  }
}
