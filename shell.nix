{ pkgs ? import <nixpkgs> {} }:
with pkgs;
mkShell {
  buildInputs = [
    nodejs-16_x
		nodejs-16_x.pkgs.pnpm
  ];
}
