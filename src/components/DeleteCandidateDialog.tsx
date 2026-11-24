import { useState } from "react";
import type { Candidate } from "../../shared/types";
import { deleteCandidate, errorMessage } from "../api";
import ConfirmDialog from "./ConfirmDialog";
import { useToast } from "./Toast";

type Props = {
  /** The candidate to delete; null keeps the dialog closed. */
  candidate: Candidate | null;
  onCancel: () => void;
  onDeleted: (candidate: Candidate) => void;
};

/** ConfirmDialog + DELETE call, shared by the card trash icon and the detail panel. */
export default function DeleteCandidateDialog({ candidate, onCancel, onDeleted }: Props) {
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);
  const name = candidate?.resumeData.name ?? "this candidate";

  async function confirm() {
    if (!candidate) return;
    setDeleting(true);
    try {
      await deleteCandidate(candidate.id);
      onDeleted(candidate);
    } catch (err) {
      toast.error(`Couldn't delete ${name}: ${errorMessage(err)}`);
      onCancel();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <ConfirmDialog
      open={candidate !== null}
      title="Delete candidate"
      message={`Delete ${name}? This removes their resume data and all call records.`}
      confirmLabel="Delete"
      destructive
      loading={deleting}
      onConfirm={() => void confirm()}
      onCancel={onCancel}
    />
  );
}
