#!/bin/bash

echo "GIT CONFIG $GIT_CONFIG_GLOBAL"
echo "DATA DIR $GITBUTLER_CLI_DATA_DIR"
echo "BUT $BUT"
echo "PROJECT NAME: $1"

# Clone the remote into a folder and add the project to the application.
pushd "$1"
  git checkout master
