Summary: An experimental compiler for IoT applications
Name: fyrlang
Version: autogenerated
Release: autogenerated
License: BSD-3-Clause
Source: autogenerated
URL: http://fyr.vs.uni-due.de/
Packager: Oskar Carl <oskar.carl@uni-due.de>

%description

%prep
%setup -q -n %{name}-%{version}

%install
%make_install

%post
# Fix security context for SELinux
# http://stackoverflow.com/questions/24288616/permission-denied-on-accessing-host-directory-in-docker
chcon -Rt svirt_sandbox_file_t %{_datarootdir}/packpack/ || :

%files
%{_bindir}/packpack
%{_datarootdir}/packpack/*
%doc README.md
%{!?_licensedir:%global license %doc}
%license LICENSE
