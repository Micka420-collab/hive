#!/usr/bin/env sh
#
# MONTER LA VM DE LA RUCHE, SUR PROXMOX.
#
#   sh scripts/vm-proxmox.sh [--essai]
#
# À lancer SUR L'HÔTE PROXMOX (console web → Shell, ou ssh root@…). Il crée UNE
# machine virtuelle prête à recevoir la ruche, et rien d'autre.
#
# ─── CE QU'IL NE FAIT PAS, ET C'EST DÉLIBÉRÉ ─────────────────────────────────
#
# · Il ne touche à AUCUNE machine existante. Il ne détruit rien, ne renomme
#   rien, ne réattribue aucun identifiant. Il CHERCHE un numéro libre au-dessus
#   de VMID_MIN et s'arrête s'il n'en trouve pas.
# · Il n'installe pas le système à votre place. L'ISO fournie est un installeur
#   INTERACTIF (subiquity) : prétendre l'automatiser depuis ici demanderait de
#   fabriquer une seconde ISO de graine, pour une poignée d'écrans qu'on passe
#   en trois minutes à la console. Voir « L'AUTRE CHEMIN » en bas si vous voulez
#   l'installation sans personne devant.
# · Il n'engendre aucun secret. Les secrets de la ruche naissent DANS la VM,
#   avec `poser-la-ruche.sh` — jamais sur l'hôte, jamais dans un dépôt.
#
# ─── POURQUOI CETTE ISO ──────────────────────────────────────────────────────
#
# `ubuntu-*-live-server` et non le bureau : 3,5 Go d'interface graphique qu'un
# serveur ne montre à personne, et autant de surface en plus. Ni OPNsense (un
# pare-feu), ni UCS (un annuaire). Debian ferait l'affaire et pèserait moins ;
# Ubuntu serveur l'emporte pour une raison mesurable et non esthétique : la CI
# de Hive est verte sur `ubuntu-latest`. Faire tourner la production sur la
# famille où la suite est éprouvée retire une classe entière de surprises.

set -eu

ESSAI=0
[ "${1:-}" = "--essai" ] && ESSAI=1

# ─── Réglages — tout se surcharge par variable d'environnement ───────────────
NOM="${VM_NOM:-ruche}"
CPU="${VM_CPU:-4}"
RAM_MO="${VM_RAM:-8192}"
DISQUE_GO="${VM_DISQUE:-64}"
PONT="${VM_PONT:-vmbr0}"
STOCKAGE="${VM_STOCKAGE:-local-lvm}"
STOCKAGE_ISO="${VM_STOCKAGE_ISO:-local}"
ISO="${VM_ISO:-ubuntu-26.04-live-server-amd64.iso}"
VMID_MIN="${VM_ID_MIN:-9000}"

dire() { printf '%s\n' "$*"; }
mourir() { printf '✘ %s\n' "$*" >&2; exit 1; }

command -v qm >/dev/null 2>&1 || mourir "\`qm\` introuvable — ce script se lance SUR l'hôte Proxmox."

# ─── Le numéro libre ─────────────────────────────────────────────────────────
#
# `qm list` d'abord, `pct list` ensuite : un conteneur LXC et une VM partagent
# le MÊME espace de numéros. Ne regarder que les VM, c'est se préparer à
# marcher sur un conteneur.
PRIS=$(
  { qm list 2>/dev/null | awk 'NR>1 {print $1}'; pct list 2>/dev/null | awk 'NR>1 {print $1}'; } \
    | sort -n | uniq
)
VMID=""
n="$VMID_MIN"
fin=$((VMID_MIN + 200))
while [ "$n" -lt "$fin" ]; do
  if ! printf '%s\n' "$PRIS" | grep -qx "$n"; then VMID="$n"; break; fi
  n=$((n + 1))
done
[ -n "$VMID" ] || mourir "aucun numéro libre entre $VMID_MIN et $fin."

# ─── L'ISO doit EXISTER — on ne crée pas une VM qui ne démarrera pas ─────────
if ! pvesm list "$STOCKAGE_ISO" 2>/dev/null | grep -q "$ISO"; then
  dire "✘ ISO « $ISO » introuvable sur le stockage « $STOCKAGE_ISO »."
  dire ""
  dire "  Ce qui s'y trouve :"
  pvesm list "$STOCKAGE_ISO" 2>/dev/null | awk '/iso/ {print "    " $1}' || true
  dire ""
  dire "  Choisissez-en une :  VM_ISO=<nom> sh $0"
  exit 2
fi

dire "→ VM « $NOM » n° $VMID"
dire "   $CPU vCPU · ${RAM_MO} Mo · ${DISQUE_GO} Go sur $STOCKAGE · pont $PONT"
dire "   démarrage sur $ISO"
dire ""
dire "   Machines existantes, INTACTES :"
qm list 2>/dev/null | awk 'NR>1 {print "     " $1 "  " $2}' || dire "     (aucune)"
dire ""

if [ "$ESSAI" -eq 1 ]; then
  dire "⏸ --essai : rien n'a été créé."
  exit 0
fi

# `--ostype l26` : noyau Linux 2.6+ — le réglage que la capture d'écran laissait
# sur « 7.x », qui désigne un noyau d'avant 2011.
qm create "$VMID" \
  --name "$NOM" \
  --ostype l26 \
  --cores "$CPU" \
  --cpu host \
  --memory "$RAM_MO" \
  --net0 "virtio,bridge=$PONT" \
  --scsihw virtio-scsi-single \
  --scsi0 "$STOCKAGE:$DISQUE_GO,discard=on,ssd=1" \
  --ide2 "$STOCKAGE_ISO:iso/$ISO,media=cdrom" \
  --boot 'order=scsi0;ide2' \
  --agent enabled=1 \
  --onboot 1

dire ""
dire "✔ VM $VMID créée. Rien d'autre n'a été touché."
dire ""
dire "  1. Démarrez-la :        qm start $VMID"
dire "  2. Ouvrez la console :  Proxmox → $NOM → Console"
dire "  3. Installez Ubuntu (≈ 3 min) — cochez « Install OpenSSH server »."
dire "  4. Dans la VM, une fois connectée :"
dire ""
dire "       curl -fsSL https://raw.githubusercontent.com/Micka420-collab/hive/main/scripts/poser-la-ruche.sh | sudo sh"
dire ""
dire "  ─── L'AUTRE CHEMIN, sans personne devant l'écran ───────────────────"
dire "  Les ISO présentes sont des installeurs interactifs. Pour une pose"
dire "  entièrement automatique, Proxmox attend une IMAGE CLOUD, pas une ISO :"
dire ""
dire "    wget https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img"
dire "    qm importdisk $VMID noble-server-cloudimg-amd64.img $STOCKAGE"
dire "    qm set $VMID --ide0 $STOCKAGE:cloudinit --ciuser hive --sshkeys ~/.ssh/authorized_keys"
dire ""
dire "  C'est plus court à l'usage, mais ça télécharge une image de plus."
