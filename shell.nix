{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    nodejs
    psmisc # Provides fuser
    lsof   # Provides lsof
  ];

  shellHook = ''
    echo "Environment loaded"
    echo "Node version: $(node -v)"
    echo "Required tools: fuser, lsof"
  '';
}
