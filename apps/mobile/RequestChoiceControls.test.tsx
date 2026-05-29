import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { DirectChoiceCards, QuestionnaireOptionCards } from "./RequestChoiceControls";

it("starts expanded and floats the shared option-details toggle outside the top choice", () => {
  render(
    <DirectChoiceCards
      choices={[
        { id: "review", label: "Review code", description: "Inspect existing code", kind: "option" },
        { id: "build", label: "Implement", description: "Build the feature", kind: "option" },
      ]}
      onSubmit={jest.fn()}
    />,
  );

  expect(screen.getByText("Inspect existing code")).toBeTruthy();
  expect(screen.getByText("Build the feature")).toBeTruthy();
  const toggle = screen.getByLabelText("Hide option details");
  expect(toggle.props.style).toEqual(expect.arrayContaining([
    expect.objectContaining({ position: "absolute", top: expect.any(Number), right: expect.any(Number) }),
  ]));
  const floatingStyle = toggle.props.style.find((entry: Record<string, unknown>) => entry?.position === "absolute");
  expect(floatingStyle.top).toBe(-10);
  expect(floatingStyle.right).toBe(-10);
  expect(toggle.props.style).toEqual(expect.arrayContaining([
    expect.objectContaining({ backgroundColor: "#f8f5ed" }),
  ]));

  fireEvent.press(toggle);
  expect(screen.queryByText("Inspect existing code")).toBeNull();
  expect(screen.queryByText("Build the feature")).toBeNull();
});

it("uses the same dark choice-card look for multi-select, adding only top-left checkbox state", () => {
  const onCancel = jest.fn();
  const onSelect = jest.fn();
  render(
    <QuestionnaireOptionCards
      hideQuestionLabel
      question={{
        question: "Which options?",
        multiSelect: true,
        options: [
          { label: "Review code", description: "Inspect existing code" },
          { label: "Implement", description: "Build the feature" },
        ],
      }}
      selectedAnswers={["Review code"]}
      cancelChoices={[{ id: "cancel", label: "Cancel", kind: "deny" }]}
      onCancel={onCancel}
      onSelect={onSelect}
    />,
  );

  expect(screen.queryByText("Which options?")).toBeNull();
  expect(screen.getByText("Select one or more")).toBeTruthy();
  expect(screen.getByText("Inspect existing code")).toBeTruthy();
  const selectedCard = screen.getByLabelText("Review code selected");
  expect(selectedCard.props.style).toEqual(expect.arrayContaining([
    expect.objectContaining({ backgroundColor: "#3c4043" }),
  ]));
  const checkbox = screen.getByText("☑");
  expect(checkbox.props.style).toEqual(expect.arrayContaining([
    expect.objectContaining({ position: "absolute", top: 10, left: 10 }),
  ]));
  fireEvent.press(screen.getByLabelText("Implement not selected"));
  expect(onSelect).toHaveBeenCalledWith("Which options?", "Implement", true);
  fireEvent.press(screen.getByText("Cancel"));
  expect(onCancel).toHaveBeenCalledWith(expect.objectContaining({ id: "cancel" }));
});
