use tempfile::{TempDir, tempdir};

pub mod testing_repository;

fn init_opts() -> git2::RepositoryInitOptions {
    let mut opts = git2::RepositoryInitOptions::new();
    opts.initial_head("master");
    opts
}

fn init_opts_bare() -> git2::RepositoryInitOptions {
    let mut opts = init_opts();
    opts.bare(true);
    opts
}

fn setup_config(config: &git2::Config) -> anyhow::Result<()> {
    match config.open_level(git2::ConfigLevel::Local) {
        Ok(mut local) => {
            local.set_str("commit.gpgsign", "false")?;
            local.set_str("user.name", "gitbutler-test")?;
            local.set_str("user.email", "gitbutler-test@example.com")?;
            Ok(())
        }
        Err(err) => Err(err.into()),
    }
}

fn signature() -> git2::Signature<'static> {
    git2::Signature::now("gitbutler-test", "gitbutler-test@example.com")
        .expect("signature is valid")
}

fn initial_commit(repo: &git2::Repository, message: &str) -> git2::Oid {
    let tree_id = repo
        .index()
        .expect("index exists")
        .write_tree()
        .expect("tree can be written");
    let tree = repo.find_tree(tree_id).expect("tree exists");
    let sig = signature();
    repo.commit(Some("refs/heads/master"), &sig, &sig, message, &tree, &[])
        .expect("initial commit succeeds")
}

pub fn test_repository() -> (git2::Repository, TempDir) {
    let tmp = tempdir().expect("tempdir exists");
    let repo = git2::Repository::init_opts(&tmp, &init_opts()).expect("repository initializes");
    setup_config(&repo.config().expect("config exists")).expect("config is writable");
    initial_commit(&repo, "Initial commit");
    (repo, tmp)
}

pub fn commit_all(repository: &git2::Repository) -> git2::Oid {
    let mut index = repository.index().expect("index exists");
    index
        .add_all(["."], git2::IndexAddOption::DEFAULT, None)
        .expect("files can be added");
    index.write().expect("index can be written");
    let tree_id = index.write_tree().expect("tree can be written");
    let tree = repository.find_tree(tree_id).expect("tree exists");
    let head = repository.head().expect("head exists");
    let parent = head.peel_to_commit().expect("head commit exists");
    let sig = signature();
    repository
        .commit(
            Some(head.name().expect("head has name")),
            &sig,
            &sig,
            "some commit",
            &tree,
            &[&parent],
        )
        .expect("commit succeeds")
}

pub struct RepoWithOrigin {
    pub local_repo: git2::Repository,
    _local_tmp: TempDir,
    _remote_repo: git2::Repository,
    _remote_tmp: TempDir,
}

impl Default for RepoWithOrigin {
    fn default() -> Self {
        let (local_repo, local_tmp) = test_repository();

        let remote_tmp = tempdir().expect("tempdir exists");
        let remote_repo = git2::Repository::init_opts(&remote_tmp, &init_opts_bare())
            .expect("bare repository initializes");
        setup_config(&remote_repo.config().expect("config exists")).expect("config is writable");

        {
            let mut remote = local_repo
                .remote(
                    "origin",
                    remote_repo.path().to_str().expect("path is valid UTF-8"),
                )
                .expect("remote can be created");
            remote
                .push(&["refs/heads/master:refs/heads/master"], None)
                .expect("push succeeds");
        }

        if local_repo
            .find_reference("refs/remotes/origin/master")
            .is_err()
        {
            let head = local_repo
                .head()
                .expect("head exists")
                .target()
                .expect("head target exists");
            local_repo
                .reference(
                    "refs/remotes/origin/master",
                    head,
                    true,
                    "create remote tracking ref for tests",
                )
                .expect("remote tracking ref can be created");
        }

        Self {
            local_repo,
            _local_tmp: local_tmp,
            _remote_repo: remote_repo,
            _remote_tmp: remote_tmp,
        }
    }
}
