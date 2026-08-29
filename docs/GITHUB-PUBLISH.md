# Publish Xdesk to GitHub safely

## Recommended workflow: GitHub Desktop

For a first public release on Windows, GitHub Desktop is the easiest safe workflow because you can inspect every file before committing.

1. Create a GitHub account if needed.
2. Install GitHub Desktop from the official GitHub website.
3. Sign in to GitHub Desktop.
4. Extract this public archive to a new folder, for example `C:\Projects\xdesk-public`.
5. Do **not** create a real `.env` inside the public source folder before the first publication. `.env.example` is enough for the repository.
6. In GitHub Desktop choose **File → Add local repository**. If prompted, create a repository in that folder.
7. Review the **Changes** list. Confirm that `.env`, TLS keys, certificates, uploads and backups are absent.
8. Commit with a message such as `Initial public release`.
9. Click **Publish repository**.
10. Choose a repository name, for example `xdesk`.
11. Clear **Keep this code private** only when you are ready to make it public.
12. Publish.

After publication, verify the GitHub repository in a browser before sharing the link.

## Command-line alternative

```bash
git init
git add .
git status
git commit -m "Initial public release"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/xdesk.git
git push -u origin main
```

Always inspect `git status` before committing.

## Before making the repository public

Search for your own real values (email addresses, public/private IPs, Telegram token prefixes, SMTP usernames). If any secret was ever committed, removing the file in a later commit is not enough: rotate the secret and remove it from Git history.
