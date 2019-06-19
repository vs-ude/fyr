#!/bin/bash

DOCKER_IMAGE?=packpack/packpack:debian-stretch
TRAVIS_JOB_ID?=2

package: build_${OS}-${DIST}
	rm -rf packpack
	git clone https://github.com/packpack/packpack.git packpack
	./packpack/packpack


build_%:
	docker run \
		--rm=true --tty=true \
		--volume "${PWD}:/fyrlang" \
		--workdir /fyrlang \
		-e TRAVIS_JOB_ID=${TRAVIS_JOB_ID} \
		packpack/packpack:$(subst build_,,$@) \
		make -f .travis.mk $(subst build_,,$@)

debian%:
	export DEBIAN_FRONTEND=noninteractive
	# apt-get -qq install -y --no-install-recommends nodejs npm >/dev/null
	ls -al
	/bin/bash dev/build.sh

ubuntu%: debian

fedora%:
	dnf -y install nodejs npm >/dev/null
	/bin/bash dev/build.sh
