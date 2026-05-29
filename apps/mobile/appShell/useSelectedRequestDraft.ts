import { useEffect, useState } from "react";

import { buildQuestionnaireAnswers, isQuestionnaireRequest, type MobileRequest } from "../requests";

export function useSelectedRequestDraft(selected: MobileRequest | undefined) {
  const [reply, setReply] = useState("");
  const [questionnaireAnswers, setQuestionnaireAnswers] = useState<Record<string, string[]>>({});

  useEffect(() => {
    setReply("");
    if (!selected || !isQuestionnaireRequest(selected)) {
      setQuestionnaireAnswers({});
      return;
    }
    setQuestionnaireAnswers(buildQuestionnaireAnswers(selected));
  }, [selected?.id]);

  return { reply, setReply, questionnaireAnswers, setQuestionnaireAnswers };
}
