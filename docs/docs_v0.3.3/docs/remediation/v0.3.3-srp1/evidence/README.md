# Evidence directory

Store immutable evidence artifacts here or link to an external CI artifact store:
- phase reports;
- raw build/test logs;
- OS isolation test logs and scripts;
- canary-secret scan outputs;
- migration test results;
- review approvals.

Every evidence record must include timestamp, commit SHA, platform, runtime versions, exact command, exit code, and artifact checksum where practical. Do not store raw secrets in evidence.
