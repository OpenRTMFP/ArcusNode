#!/bin/bash  

# Exit on error
set -e

BUILD_PATH="$( cd -P "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Checking path to repository
echo "Build path directory: $BUILD_PATH"

echo "Executing as user $(whoami)"

# Create build dir
if [ ! -d "$BUILD_PATH/bin" ]; then
  mkdir "$BUILD_PATH/bin" && chown -R "$(whoami).$(whoami)" "$BUILD_PATH/bin"
fi

# Remove previous build
rm -f "$BUILD_PATH/bin/hello.swf"

mxmlc -output="$BUILD_PATH/bin/hello.swf" -source-path+="$BUILD_PATH/lib" --target-player=11.2 -debug -swf-version 16 "$BUILD_PATH/src/Hello.as" -static-link-runtime-shared-libraries=true